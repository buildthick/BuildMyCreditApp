#Pay
unpaid late balances = 0
&
unpaid collection balances = 0
&
utilization = +/- 5% of target
from /user_openAndCloseAdjustments document
where `Unique_Name` = "Utilization"
value from field `User_Value`

#Open
when count of documents
where field `stock` = "user_loans" OR "user_credit_cards"
AND field `isCurrent` = true
