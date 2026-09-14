# Backtest de BTC/USDT

Instalação e execução (Python 3.10+):

```sh
python -m pip install -r requirements-backtest.txt
python backtest.py
python backtest.py --technical-only --end 2026-09-14
python -m unittest test_backtest -v
```

O período padrão é o último ano calendário até a meia-noite UTC de hoje, exclusivo. `--end 2026-09-14` testa 2025-09-14 a 2026-09-13. São baixados mais 100 dias de aquecimento, que não entram no resultado (há um candle anterior para inicialização do simulador). Somente candles concluídos de 15 minutos do BTCUSDT Spot são aceitos. Lacunas, duplicatas e OHLC inválidos interrompem a execução.

Sem `--technical-only`, o bloqueio macro/derivativos do site é preservado: zero operações é o resultado esperado. Com essa opção, avalia-se apenas uma hipótese técnica experimental baseada nas EMA20/50, RSI simples e volume do app.js, usando candles encerrados de 15M/4H/1D. Score máximo técnico: 80. Não é uma reprodução completa do documento Elder: ADX, correções, gatilhos Elder, notícias e funding ainda não são implementados. Os resultados não validam o sistema completo.

Simulação Spot somente comprada, sem alavancagem, no máximo uma entrada por dia e uma posição aberta. Stop de 1,5 ATR14 simples, alvo único de 2R, risco nominal máximo de 1% incluindo custos estimados e exposição limitada a 95% do capital. Não há TP1/TP2/TP3 parciais, break-even, trailing ou circuit breakers. As EMA seguem as janelas do dashboard; ATR14 corrige as 15 observações usadas atualmente pelo app.js.

Ordens executam na abertura seguinte. Gaps podem exceder o risco estimado e alterar o R:R. Taxa padrão de 0,1% e custo de slippage de 0,05% são cobrados em cada ponta. O slippage é uma aproximação em dinheiro somada à comissão, não um deslocamento do preço executado. O spread histórico não está disponível. Candle que toca stop e alvo depende das convenções do backtesting.py. Posições remanescentes são encerradas pelo simulador no fim do período.

Saídas em `backtest-results/`: `summary.json` (retorno, Sharpe, drawdown, profit factor, win rate, expectancy e limitações), `trades.csv`, `equity.csv`, `candles.csv` e gráfico interativo `report.html`. Métricas indefinidas são null, não zero nem aprovação. Não há otimização/walk-forward nem promessa de rentabilidade.

Para dados locais use `--csv arquivo.csv`: colunas `timestamp,Open,High,Low,Close,Volume`, timestamps UTC de abertura, incluindo os 100 dias anteriores ao ano testado. O CSV exportado pode ser reutilizado. Não são necessárias chaves Binance. Falhas de rede nunca geram dados fictícios.

Referência: https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html
