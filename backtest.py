"""BTCUSDT 15m historical test. See BACKTEST.md for scope and limitations."""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from backtesting import Strategy
from backtesting.lib import FractionalBacktest

STEP = pd.Timedelta(minutes=15)


def download(start, end):
    """Fetch closed spot candles; index is UTC OPEN time."""
    cursor, finish = int(start.timestamp()*1000), int(end.timestamp()*1000)
    rows = []
    with requests.Session() as session:
        while cursor < finish:
            response = session.get('https://api.binance.com/api/v3/klines', params={
                'symbol': 'BTCUSDT', 'interval': '15m', 'startTime': cursor,
                'endTime': finish-1, 'limit': 1000}, timeout=30)
            response.raise_for_status()
            batch = response.json()
            if not isinstance(batch, list) or not batch:
                raise ValueError('Incomplete Binance response; refusing a partial year')
            rows.extend(batch)
            following = int(batch[-1][0]) + int(STEP.total_seconds()*1000)
            if following <= cursor:
                raise ValueError('Pagination failed to advance')
            cursor = following
    data = pd.DataFrame(rows)
    result = data.iloc[:, 1:6].astype(float)
    result.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
    result.index = pd.to_datetime(data[0], unit='ms', utc=True)
    return result


def validate(data, start, end):
    data = data.loc[(data.index >= start) & (data.index < end)].copy()
    expected = pd.date_range(start, end, freq=STEP, inclusive='left')
    if not data.index.equals(expected):
        raise ValueError('CSV/API must contain every 15m bar, sorted and unique, including warm-up')
    values = data[['Open', 'High', 'Low', 'Close', 'Volume']]
    if not np.isfinite(values.to_numpy()).all() or (values.Volume < 0).any():
        raise ValueError('Invalid numeric values')
    if (values.iloc[:, :4] <= 0).any().any():
        raise ValueError('Prices must be positive')
    if ((data.High < data[['Open', 'Close', 'Low']].max(axis=1)) |
            (data.Low > data[['Open', 'Close', 'High']].min(axis=1))).any():
        raise ValueError('Invalid OHLC bounds')
    return data


def trend(close):
    # Match the rolling EMA windows in app.js, but use only finished candles.
    def last_ema(series, period):
        return series.ewm(span=period, adjust=False).mean().iloc[-1]
    fast = close.rolling(60).apply(lambda x: last_ema(x, 20))
    slow = close.rolling(80).apply(lambda x: last_ema(x, 50))
    return pd.Series(np.select([(close > fast) & (fast > slow),
                               (close < fast) & (fast < slow)], [1, -1], 0), index=close.index)


def features(data):
    out = data.copy()
    # Use CLOSE timestamps for joining; then restore the open-time index.
    closed = data.copy()
    closed.index += STEP
    directions = []
    for rule in ['15min', '4h', '1D']:
        bars = closed.resample(rule, closed='right', label='right').agg({
            'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'})
        directions.append(trend(bars.Close).reindex(closed.index, method='ffill').to_numpy())
    a, b, c = directions
    delta = data.Close.diff()
    gains = delta.clip(lower=0).rolling(14).mean()
    losses = -delta.clip(upper=0).rolling(14).mean()
    rsi = (100-100/(1+gains/losses)).where(losses != 0, 100)
    volume = data.Volume >= 1.5*data.Volume.shift().rolling(20).mean()
    momentum = ((b == 1) & rsi.between(50, 72, inclusive='neither')) | ((b == -1) & rsi.between(28, 50, inclusive='neither'))
    aligned = (b == c) & (b != 0)
    score = 16*(aligned.astype(int)+(a == b).astype(int)+(a != 0).astype(int)+volume.astype(int)+momentum.astype(int))
    tr = pd.concat([data.High-data.Low, (data.High-data.Close.shift()).abs(),
                    (data.Low-data.Close.shift()).abs()], axis=1).max(axis=1)
    # ATR14 simple mean (dashboard currently incorrectly uses 15 observations).
    out['Distance'] = 1.5*tr.rolling(14).mean()/data.Close
    out['Score'] = score
    out['Signal'] = np.where(aligned & (a == b) & (score >= 70), b, 0)
    return out


class Sniper(Strategy):
    technical_only = False
    risk = .01
    costs = .0015

    def init(self):
        self.last_day = None

    def next(self):
        if self.position or self.orders or not self.technical_only:
            return
        day = self.data.index[-1].date()
        if day == self.last_day or self.data.Signal[-1] != 1:
            return  # Spot long-only; no fictitious futures short/funding simulation.
        distance = float(self.data.Distance[-1])
        price = self.data.Close[-1]
        if not np.isfinite(distance) or distance <= 0 or distance >= .3:
            return
        # FractionalBacktest transforms BTC into 1e-6 BTC units.
        units = int(min(self.equity*self.risk/(price*(distance+2*self.costs)),
                        self.equity*.95/(price*(1+self.costs))))
        if units < 1:
            return
        self.buy(size=units, sl=price*(1-distance), tp=price*(1+2*distance),
                 tag=f'score={self.data.Score[-1]}')
        self.last_day = day


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--end', help='Exclusive UTC end date; default today')
    parser.add_argument('--csv', type=Path, help='CSV: timestamp,Open,High,Low,Close,Volume (UTC open times)')
    parser.add_argument('--technical-only', action='store_true')
    parser.add_argument('--cash', type=float, default=10000)
    parser.add_argument('--commission', type=float, default=.001)
    parser.add_argument('--slippage', type=float, default=.0005)
    parser.add_argument('--output', type=Path, default=Path('backtest-results'))
    args = parser.parse_args()
    end = pd.Timestamp(args.end, tz='UTC') if args.end else pd.Timestamp.now(tz='UTC').normalize()
    if end != end.normalize() or end > pd.Timestamp.now(tz='UTC').normalize():
        parser.error('--end must be a completed UTC midnight')
    if args.cash <= 0 or not 0 <= args.commission < .1 or not 0 <= args.slippage < .1:
        parser.error('Invalid cash or cost parameters')
    start = end-pd.DateOffset(years=1)
    warmup = start-pd.Timedelta(days=100)
    if args.csv:
        data = pd.read_csv(args.csv, index_col='timestamp')
        data.index = pd.to_datetime(data.index, utc=True)
    else:
        data = download(warmup, end)
    data = validate(data, warmup, end)
    enriched = features(data)
    # One preceding bar allows first test-day next() without counting warm-up returns.
    sample = enriched.loc[start-STEP:end-STEP]
    bt = FractionalBacktest(sample, Sniper, fractional_unit=.000001, cash=args.cash,
                           commission=args.commission+args.slippage, trade_on_close=False,
                           exclusive_orders=True, finalize_trades=True)
    stats = bt.run(technical_only=args.technical_only, costs=args.commission+args.slippage)
    args.output.mkdir(parents=True, exist_ok=True)
    data.to_csv(args.output/'candles.csv', index_label='timestamp')
    stats['_trades'].to_csv(args.output/'trades.csv', index=False)
    stats['_equity_curve'].to_csv(args.output/'equity.csv')
    summary = {k: (None if pd.isna(v) else float(v) if isinstance(v, (int, float, np.number)) else str(v))
               for k, v in stats.items() if not k.startswith('_')}
    summary.update(mode='technical-experimental' if args.technical_only else 'strict-blocked',
                   period_start=str(start), period_end_exclusive=str(end),
                   commission_per_side=args.commission, slippage_cost_per_side=args.slippage,
                   limitations=['Spot long-only', 'Single 2R target; no partial exits',
                                'No macro/derivatives history, ADX or full Elder implementation',
                                'Slippage is a cash cost, not simulated price movement',
                                'Next-open gaps can exceed planned risk and change realized R:R',
                                'OHLC intrabar stop/target ordering is unknown; engine conventions apply'])
    (args.output/'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False))
    bt.plot(filename=str(args.output/'report.html'), open_browser=False, superimpose=False)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
