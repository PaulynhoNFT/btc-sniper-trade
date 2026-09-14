import unittest
import numpy as np
import pandas as pd
from backtest import features, validate, Sniper
from backtesting.lib import FractionalBacktest


class BacktestTests(unittest.TestCase):
    def setUp(self):
        index = pd.date_range('2024-01-01', periods=170*24, freq='1h', tz='UTC')
        price = 30000+np.arange(len(index))*.1
        self.data = pd.DataFrame(dict(Open=price, High=price+10, Low=price-10,
                                      Close=price+1, Volume=100.), index=index)

    def test_future_does_not_change_past(self):
        before = features(self.data)
        altered = self.data.copy()
        altered.iloc[-40:, :4] *= 2
        after = features(altered)
        pd.testing.assert_frame_equal(before.iloc[:-40], after.iloc[:-40])

    def test_missing_candle_rejected(self):
        with self.assertRaises(ValueError):
            validate(self.data.drop(self.data.index[10]), self.data.index[0],
                     self.data.index[-1]+pd.Timedelta(minutes=15))

    def test_strict_blocks_and_technical_executes_next_open(self):
        frame = self.data.iloc[:100].copy()
        frame['Signal'] = 1
        frame['Score'] = 80
        frame['Distance'] = .01
        frame['AtrRatio'] = .006
        def run(enabled):
            return FractionalBacktest(frame, Sniper, fractional_unit=.000001,
                                      cash=10000, commission=.0015,
                                      finalize_trades=True).run(technical_only=enabled)
        self.assertEqual(run(False)['# Trades'], 0)
        trades = run(True)['_trades']
        self.assertGreater(len(trades), 0)
        self.assertEqual(trades.iloc[0].EntryBar, 2)
        self.assertLessEqual(trades.iloc[0].Size*trades.iloc[0].EntryPrice, 9500)


if __name__ == '__main__':
    unittest.main()
