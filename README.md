# BTC Sniper — Elder 1.0

Terminal BTCUSDT com gráfico de candles, EMA13, níveis técnicos condicionais e perfis Swing/Scalp.

Motor compartilhado entre navegador (`engine.js`) e backtesting.py via Node. Leia [BACKTEST.md](BACKTEST.md) para regras, execução, testes e limitações.

Abra index.html por um servidor HTTP estático. Requer acesso aos endpoints públicos da Binance. Não é necessário fornecer chaves.

As confirmações macro, derivativos e estado de risco da conta ainda não estão integradas: sinais ao vivo permanecem bloqueados. O diário guarda observações, não apura P&L. O teste técnico anual Swing Elder não encontrou entradas; isso não demonstra rentabilidade. Relatórios da versão experimental anterior permanecem em backtests/2026-09-14; o novo está em backtests/elder-1.0.0.

Não executa ordens. Validação visual no navegador ainda pendente: instalação de Chromium indisponível no ambiente de desenvolvimento.
