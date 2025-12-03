### How it works
1. Loaders take data from origin accounts and create an in-memory stocks_conso shape dataset
2. They also take:
   offers_loans -- for open actions
   offers_cards -- for open actions
   user -- for budget and loan permissions
   cycle number from UI -- to determine the length of the simulation
   user_openAndCloseAdjustments -- for those respective actions
3. They store these in the SimulationState file
4. tickOneMonth applies the logic from pay/open/close/use files on a single-cycle basis, "running" the simulation
5. Results get pushed to SimulationState file, which loops data into deltaLogs at the stocks_conso level and updates aggregate metrics with timestamp (no deltaLogs needed)
6. SimulationState keeps a record of the current cycle and stops when cycle number reached
7. writeSimOutputs writes the results to three top-level Firebase collections:
   /user_sim_stocks_conso
   /user_sim_deltaLog_stocks_conso
   /user_sim_agg_metrics
