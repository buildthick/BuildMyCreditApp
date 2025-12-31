#Pay
unpaid late balances = 0
&
unpaid collection balances = 0
&
utilization = +/- 5% of target
from /user_openAndCloseAdjustments document
where `Unique_Name` = "Utilization"
value from field `User_Value`

#Use
when
utilization = +/- 5% of target
from /user_openAndCloseAdjustments document
where `Unique_Name` = "Utilization"
value from field `User_Value`

#Open
Stops when 
allocation_loans_to_open = 0
and
allocation_current_open_cards = allocation_cards_to_open 

#Close
When zero cards left in /user_card_close_candidates
