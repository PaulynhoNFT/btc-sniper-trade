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
                'symbol': 'BTCUSDT', 'interval': '5m' if STEP == pd.Timedelta(minutes=5) else '15m', 'startTime': cursor,
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


def features(data, profile='swing'):
    """Run the same causal JS engine used by the dashboard."""
    import subprocess
    rows = [dict(t=int(t.timestamp()*1000), o=r.Open, h=r.High, l=r.Low,
                 c=r.Close, v=r.Volume) for t, r in data.iterrows()]
    process = subprocess.run(['node', str(Path(__file__).with_name('engine-batch.cjs'))],
        input=json.dumps(dict(rows=rows, profile=profile, step=int((data.index[1]-data.index[0]).total_seconds()*1000))),
        text=True, capture_output=True, check=True)
    signals = pd.DataFrame(json.loads(process.stdout))
    out = data.copy()
    for col, source in [('Signal', 'signal'), ('Score', 'score'), ('Distance', 'distance'), ('AtrRatio', 'atr')]:
        out[col] = signals[source].to_numpy()
    return out


class Sniper(Strategy):
    technical_only = False
    risk = .01
    costs = .0015

    def init(self):
        self.last_day = None
        self.day = None
        self.week = None
        self.day_equity = self.equity
        self.week_equity = self.equity
        self.paused = False
        self.daily_stop = False
        self.loss_bar = -100
        self.closed_count = 0
        self.phase = 0

    def next(self):
        bar = len(self.data)-1
        now = self.data.index[-1]
        day, week = now.date(), now.isocalendar()[:2]
        if day != self.day:
            self.day, self.day_equity, self.daily_stop = day, self.equity, False
        if week != self.week:
            self.week, self.week_equity = week, self.equity
        self.daily_stop |= self.equity <= self.day_equity*.97
        self.paused |= self.equity <= self.week_equity*.93  # requires manual review/new run
        for trade in self.closed_trades[self.closed_count:]:
            if trade.pl < 0:
                self.loss_bar = bar
            if trade.pl > 0 and trade.tag == 'TP1':
                self.phase = max(self.phase, 1)
            if trade.pl > 0 and trade.tag == 'TP2':
                self.phase = 2
        self.closed_count = len(self.closed_trades)
        for trade in self.trades:
            if self.phase >= 1:
                trade.sl = max(trade.sl or 0, trade.entry_price)
            if self.phase >= 2:
                trailing = self.data.Close[-1]*(1-2*self.data.AtrRatio[-1])
                trade.sl = max(trade.sl or 0, trailing)
            if bar-trade.entry_bar >= 20 and self.phase == 0:
                trade.close()
        if self.position or self.orders or not self.technical_only:
            return
        if self.daily_stop or self.paused or bar-self.loss_bar <= 2 or day == self.last_day:
            return
        if self.data.Signal[-1] != 1:
            return
        distance = float(self.data.Distance[-1])
        price = self.data.Close[-1]
        if not np.isfinite(distance) or not 0 < distance < .3:
            return
        units = int(min(self.equity*self.risk/(price*(distance+2*self.costs)),
                        self.equity*.95/(price*(1+self.costs))))
        portions = [int(units*.33), int(units*.33)]
        portions.append(units-sum(portions))
        if min(portions) < 1:
            return
        self.phase = 0
        for i, quantity in enumerate(portions, 1):
            self.buy(size=quantity, sl=price*(1-distance), tp=price*(1+i*distance), tag=f'TP{i}')
        self.last_day = day


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['swing', 'scalp'], default='swing')
    parser.add_argument('--end', help='Exclusive UTC end date; default today')
    parser.add_argument('--csv', type=Path, help='CSV: timestamp,Open,High,Low,Close,Volume (UTC open times)')
    parser.add_argument('--technical-only', action='store_true')
    parser.add_argument('--cash', type=float, default=10000)
    parser.add_argument('--commission', type=float, default=.001)
    parser.add_argument('--slippage', type=float, default=None)
    parser.add_argument('--output', type=Path, default=Path('backtest-results'))
    args = parser.parse_args()
    global STEP
    STEP = pd.Timedelta(minutes=5 if args.profile == 'scalp' else 15)
    if args.slippage is None:
        args.slippage = .001 if args.profile == 'scalp' else .0005
    end = pd.Timestamp(args.end, tz='UTC') if args.end else pd.Timestamp.now(tz='UTC').normalize()
    if end != end.normalize() or end > pd.Timestamp.now(tz='UTC').normalize():
        parser.error('--end must be a completed UTC midnight')
    if args.cash <= 0 or not 0 <= args.commission < .1 or not 0 <= args.slippage < .1:
        parser.error('Invalid cash or cost parameters')
    start = end-pd.DateOffset(years=1)
    warmup = start-pd.Timedelta(days=10 if args.profile == 'scalp' else 200)
    if args.csv:
        data = pd.read_csv(args.csv, index_col='timestamp')
        data.index = pd.to_datetime(data.index, utc=True)
    else:
        data = download(warmup, end)
    data = validate(data, warmup, end)
    raw_data = data.copy()
    data = data.resample('5min' if args.profile == 'scalp' else '1h').agg({'Open':'first','High':'max','Low':'min','Close':'last','Volume':'sum'})
    enriched = features(data, args.profile)
    # One preceding bar allows first test-day next() without counting warm-up returns.
    sample = enriched.loc[start-pd.Timedelta(minutes=5 if args.profile == 'scalp' else 60):end-STEP]
    bt = FractionalBacktest(sample, Sniper, fractional_unit=.000001, cash=args.cash,
                           commission=args.commission+args.slippage, trade_on_close=False,
                           exclusive_orders=False, finalize_trades=True)
    stats = bt.run(technical_only=args.technical_only, risk=.005 if args.profile == 'scalp' else .01, costs=args.commission+args.slippage)
    args.output.mkdir(parents=True, exist_ok=True)
    raw_data.to_csv(args.output/'candles.csv', index_label='timestamp')
    stats['_trades'].to_csv(args.output/'trades.csv', index=False)
    stats['_equity_curve'].to_csv(args.output/'equity.csv')
    summary = {k: (None if pd.isna(v) else float(v) if isinstance(v, (int, float, np.number)) else str(v))
               for k, v in stats.items() if not k.startswith('_')}
    summary.update(mode='technical-experimental' if args.technical_only else 'strict-blocked',
                   engine_version='elder-1.0.0', profile=args.profile, period_start=str(start), period_end_exclusive=str(end),
                   commission_per_side=args.commission, slippage_cost_per_side=args.slippage,
                   limitations=['Spot long-only', 'Three tranches: 33%, 33%, 34%; targets 1R/2R/3R',
                                'Technical-only excludes historical macro/derivatives and spread confirmation',
                                'Slippage is a cash cost, not simulated price movement',
                                'Next-open gaps can exceed planned risk and change realized R:R',
                                'Metrics count exit tranches, not grouped setups',
                                'Break-even/trailing updates occur after bar close',
                                'OHLC intrabar stop/target ordering is unknown; engine conventions apply'])
    (args.output/'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False))
    bt.plot(filename=str(args.output/'report.html'), open_browser=False, superimpose=False)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
