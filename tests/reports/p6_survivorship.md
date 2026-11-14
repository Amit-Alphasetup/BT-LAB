# P6 survivorship report

Dataset 2026-11-12-r1, 2010-01-01 .. 2026-11-12, 10 slots, Rs 5,00,000, ranking momentum, Zerodha delivery costs.
A = today's members over the whole period (biased) · B = point-in-time, sell at the next open after removal · C = point-in-time, hold until the strategy sells.

| Index | Preset | Run | Symbols | Trades | Removal sells | CAGR % | Max DD % | Final Rs |
|---|---|---|---|---|---|---|---|---|
| NIFTY 50 | ma_stack | A today-list | 50 | 2748 | 0 | 1.05 | 20.25 | 6,03,144 |
| NIFTY 50 | ma_stack | B pit-exit | 89 | 2756 | 7 | -2.19 | 38.16 | 3,36,113 |
| NIFTY 50 | ma_stack | C pit-hold | 89 | 2750 | 0 | -2.22 | 38.56 | 3,34,540 |
| NIFTY 50 | golden_cross | A today-list | 50 | 95 | 0 | 4.7 | 35.91 | 11,38,972 |
| NIFTY 50 | golden_cross | B pit-exit | 89 | 75 | 1 | 5.97 | 38.3 | 14,14,673 |
| NIFTY 50 | golden_cross | C pit-hold | 89 | 82 | 0 | 5.58 | 38.3 | 13,25,012 |
| NIFTY 50 | high52w | A today-list | 50 | 30 | 0 | -0.06 | 2.3 | 4,94,502 |
| NIFTY 50 | high52w | B pit-exit | 89 | 29 | 0 | -0.06 | 2.3 | 4,94,614 |
| NIFTY 50 | high52w | C pit-hold | 89 | 29 | 0 | -0.06 | 2.3 | 4,94,614 |
| NIFTY NEXT 50 | ma_stack | A today-list | 50 | 2447 | 0 | 3.57 | 8.95 | 9,37,457 |
| NIFTY NEXT 50 | ma_stack | B pit-exit | 160 | 2637 | 24 | 0.23 | 22.37 | 5,20,731 |
| NIFTY NEXT 50 | ma_stack | C pit-hold | 160 | 2623 | 0 | 0.33 | 21.86 | 5,30,840 |
| NIFTY NEXT 50 | golden_cross | A today-list | 50 | 101 | 0 | 23.41 | 43.8 | 2,17,51,565 |
| NIFTY NEXT 50 | golden_cross | B pit-exit | 160 | 86 | 10 | 4.78 | 39.43 | 11,56,091 |
| NIFTY NEXT 50 | golden_cross | C pit-hold | 160 | 90 | 0 | 5.42 | 39.43 | 12,89,705 |
| NIFTY NEXT 50 | high52w | A today-list | 50 | 43 | 0 | 0.54 | 3.63 | 5,51,170 |
| NIFTY NEXT 50 | high52w | B pit-exit | 160 | 24 | 2 | -0.13 | 3.7 | 4,88,528 |
| NIFTY NEXT 50 | high52w | C pit-hold | 160 | 24 | 0 | -0.13 | 3.74 | 4,88,343 |
| NIFTY 100 | ma_stack | A today-list | 100 | 2960 | 0 | 2.9 | 18.91 | 8,34,814 |
| NIFTY 100 | ma_stack | B pit-exit | 189 | 3040 | 10 | -1.1 | 34.24 | 4,09,998 |
| NIFTY 100 | ma_stack | C pit-hold | 189 | 3030 | 0 | -0.99 | 35.19 | 4,18,109 |
| NIFTY 100 | golden_cross | A today-list | 100 | 118 | 0 | 4.43 | 49.12 | 10,88,008 |
| NIFTY 100 | golden_cross | B pit-exit | 189 | 122 | 1 | 3.89 | 61.54 | 9,91,927 |
| NIFTY 100 | golden_cross | C pit-hold | 189 | 116 | 0 | 2.44 | 59.17 | 7,71,327 |
| NIFTY 100 | high52w | A today-list | 100 | 71 | 0 | 0.51 | 4.36 | 5,48,144 |
| NIFTY 100 | high52w | B pit-exit | 189 | 50 | 1 | -0.15 | 4.48 | 4,86,754 |
| NIFTY 100 | high52w | C pit-hold | 189 | 50 | 0 | -0.15 | 4.45 | 4,86,892 |

- NIFTY 50: 10 past members with no price data (not tradable in B/C): CAIRN, HDFC, IDFC, JPASSOCIAT, MCDOWELL-N, RANBAXY, RELCAPITAL, STER, TATAMOTORS, TATAMTRDVR
- NIFTY NEXT 50: 16 past members with no price data (not tradable in B/C): ABIRLANUVO, ANDHRABANK, CAIRN, CORPBANK, GSKCONS, INGVYSYABK, MCDOWELL-N, MINDTREE, MOSERBAER, PATNI, PEL, PUNJLLOYD, RANBAXY, RELCAPITAL, RNRL, SYNDIBANK
- NIFTY 100: 22 past members with no price data (not tradable in B/C): ABIRLANUVO, ANDHRABANK, CAIRN, CORPBANK, GSKCONS, HDFC, IDFC, INGVYSYABK, JPASSOCIAT, MCDOWELL-N, MINDTREE, MOSERBAER, PATNI, PEL, PUNJLLOYD, RANBAXY, RELCAPITAL, RNRL, STER, SYNDIBANK, TATAMOTORS, TATAMTRDVR
