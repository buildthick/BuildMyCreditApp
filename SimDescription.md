## How it works
### 1 - SimulatePlan CF file is firebase Entry Point for the following functions
1. Loaders take data from origin accounts and create an in-memory stocks_conso shape dataset
2. They also take:<br>
   offers_loans -- for open actions<br>
   offers_cards -- for open actions<br>
   user -- for budget and loan permissions<br>
   cycle number from UI -- to determine the length of the simulation<br>
   user_openAndCloseAdjustments -- for those respective actions<br>
3. They store these in the SimulationState file
4. tickOneMonth applies the logic from pay/open/close/use files on a single-cycle basis, "running" the simulation
5. Results get pushed to SimulationState file, which loops data into deltaLogs at the stocks_conso level and updates aggregate metrics with timestamp (no deltaLogs needed)
6. SimulationState keeps a record of the current cycle and stops when cycle number reached
7. writeSimOutputs writes the results to three top-level Firebase collections:
   /user_sim_stocks_conso
   /user_sim_deltaLog_stocks_conso
   /user_sim_agg_metrics

### Agg Metrics:
#### *Done later in UI, not in sim!*
1. For all stock types:
   installment;
   revolving;
   lates;
   collections;
   Count of Payments (since so many ppl think number of payments is a ranking factor despite FICO documentation and consumer evidence not suggesting it)
   FICO score
3. Variables possible: account, amounts owed (paid and unpaid), age, utilization
4. In these aggregations: sum, average, max, min, count, and score itself singular value for FICO
