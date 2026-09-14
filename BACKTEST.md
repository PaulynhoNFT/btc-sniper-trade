# Elder 1.0 — motor compartilhado

```sh
python -m pip install -r requirements-backtest.txt
node test_engine.cjs
python -m unittest test_backtest -v
python backtest.py --technical-only --profile swing --end 2026-09-14
python backtest.py --technical-only --profile scalp --end 2026-09-14
```

Requer Python 3.10+ e Node.js 18+. Sem `--technical-only`, as fontes externas ausentes bloqueiam operações, como no site. A opção experimental testa exclusivamente os critérios técnicos; não equivale à validação integral de execução ao vivo.

## Regras implementadas

Motor único `engine.js`, consumido pelo navegador e pelo adaptador histórico `engine-batch.cjs`. Swing: 1D/4H/1H, risco máximo 1%, stop 1,5 ATR. Scalp: 1H/15M/5M, risco máximo 0,5%, stop 1 ATR. Apenas candles encerrados; timeframes superiores são disponibilizados no fechamento.

Tela 1: preço/EMA13, sinal do MACD12/26/9 e inclinação do histograma, ADX Wilder ≥20. Tela 2: RSI30/70, estocástico20/80 ou Elder-Ray em correção, com contato de zona. Tela 3: ao menos três entre cruzamento MACD, RSI saindo de extremo, cruzamento estocástico, engolfo/martelo/estrela e rompimento com volume. Bollinger20/2 e ATR14 Wilder são filtrados por distribuição histórica.

Escolhas determinísticas para requisitos antes qualitativos: proximidade de zona = 0,25 ATR; suporte/resistência = extremos das 20 barras anteriores; Fibonacci38,2/50/61,8% sobre esse intervalo. Bollinger: largura entre percentis20/80 das 100 barras anteriores. Score: 25/15 para tendência forte/fraca, correção20, gatilhos20, volume10, candle10, zona10, alvos5. ADX20–25 exige80; ADX≥25 exige70. Score não é probabilidade de acerto. Os alvos são 1R/2R/3R brutos; saída ponderada completa corresponde a 2,01R antes de custos.

Backtest: BTC Spot somente comprado, sem alavancagem. Saídas em três frações de33/33/34%, break-even após TP1, trailing2ATR após TP2, stop de tempo20 candles sem TP1, cooldown2 candles após loss, no máximo um setup por dia. Perda diária3% pausa até dia seguinte; perda semanal7% pausa pelo restante da execução (revisão manual necessária). Uma posição lógica por vez. Não há ordens pendentes de entrada: execução a mercado na abertura seguinte, portanto expiração de ordem pendente não se aplica.

Taxa padrão0,1% por ponta; custo aproximado de slippage0,05% swing /0,1% scalp por ponta. Gaps podem ultrapassar risco e alterar R:R. Break-even/trailing são atualizados somente após o candle; não se assume trajetória intrabar. Estatísticas do backtesting.py contam frações fechadas, não setups agrupados. Finalização de posições usa convenção do simulador. Não há funding porque não são simulados futuros/vendas a descoberto.

## O que continua indisponível

Calendário macro verificado e confirmação de derivativos não têm integração implementada. O site permanece bloqueado também enquanto não houver estado de gestão de risco de uma conta. Não existe execução real, corretora paper persistente ou apuração automática de P&L no navegador. O diário salva análises auditáveis e não fabrica wins/losses. Teste técnico não usa calendário, spread histórico ou funding. Walk-forward e validação independente ainda não executados.

## Dados e relatório

Um ano calendário terminado na data UTC exclusiva `--end`. Aquecimento:200 dias swing ou10 dias scalp. Dados Binance de15m (swing) ou5m (scalp), agregados para execução. Falhas, lacunas ou dados inválidos interrompem o processo. `--csv` aceita `timestamp,Open,High,Low,Close,Volume`, timestamps UTC de abertura, na frequência de entrada respectiva e com aquecimento completo. Saídas: summary.json, trades.csv, equity.csv, candles.csv, report.html. O CSV exportado preserva a frequência de entrada e pode ser reutilizado.

## Gráfico

Canvas local, sem dependência de CDN. Candles encerrados e EMA13, seleção Swing/Scalp e60/120/240 candles. Linhas de entrada/stop/TP somente para configuração técnica válida, explicitamente ilustrativas enquanto os vetos externos persistirem. Sem sinal, não são desenhados alvos fictícios.

Referência do simulador: https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html
