Tool to monitor comprehensive engagement for a campaign. 

What is the “Campaign”?
The campaign consists of three major things that we monitor:
Main Tweet - Posted by the founder of the company or the official company’s account. 
Tweets by the influencer (which maybe a quote tweet of the main tweet or standalone tweet)
Tweets by the investor (which maybe a quote tweet of the main tweet or standalone tweet)


What does the tool achieve?
The goal of this tool is to 
Provide total engagement metrics such as total views, likes, retweets, quote tweets, location heat map, etc. and display them in real-time in a dashboard. 
Monitor all accounts engaging with these tweets and identify high-value interactions using an “importance scoring algorithm” (detailed below). 
Send real-time alerts when important accounts engage with campaign tweets, including
Top accounts that reply or retweet (updated every 30 minutes)
Quote tweet notifications with contextual analysis (e.g., "Garry Tan quote-tweeted your post, highlighting how this product can unlock a new era of voice interfaces")
Generate a detailed report after 3 days.
Calculate and display the estimated advertising cost to achieve equivalent reach using CPM (cost per thousand impressions), showing the value of organic engagement versus paid promotion.

What would be monitored? How would it be monitored? And how would we use the extracted data?

Monitor the main tweet every 30 mins up to 72 hrs and extract real time metrics which includes number of likes, retweets, quote-tweets and replies. 
Monitor the main tweet every 30 minutes up to 72 hrs, extract all the important people who replied or retweeted and send notifications of the top important accounts every 30 minutes.
Monitor the accounts which have quote-tweeted the main tweet, analyze if they are important enough, extract the quote-tweet content to understand it and send a custom notification like - “Garry Tan quote-tweeted your tweet and added how this product can unlock new era of Voice interface”.
Repeat the above 3 points for tweets by influencers and investors to get the whole picture. 
Add and show the cumulative views, likes, retweets, quotetweets in a dashboard in real time. 


How do we determine who is more important and filter out the noise?
We calculate an important score for each account that engages with a tweet. 

Prerequisites: A list with important people’s accounts with different weights assigned to them according to their influence/importance.

The importance score is then calculated as follows: 

We check how many accounts from our Important people list follow that specific account.
We have assigned some specific weight to each important account. We calculate the cumulative weight of that specific account. This gives us a sense of how important the engager is, and then we arrange these engagers in descending order. 

Let’s say X and Y both engage with a tweet. X is followed by A and D, while Y is followed by A, B and C. And we have A, B,C and D accounts in our important people list with these weights.

Account  and weight 
A - 4
B - 2
C - 1 
D - 5

The importance score for X’s account would be calculated as the sum of weights of important accounts that follow them. That is A’s weight (4) + D’s weight (5) = 9. 
Similarly, Importance score for Y’s account would be A’s weight (4) + B’s weight (2) + C’s weight (1) = 7

So X will be perceived as more important than Y despite having less number of important accounts following them. 


Where is this engagement coming from?

We would also extract the location of each of the accounts that are engaging to create a geographical heatmap. This would highlight that the views are coming from developed countries with high purchasing power or specifically the US.
We haven’t yet figured out a reliable way to extract the location apart from the data we get from API. But it is not reliable enough as you could put just anything as your location from specific building name to general region like asia to just about anything as milky way. 


In talks with API providers for a reliable way to extract this.

What is the monetary value we create?

We will show what the estimated cost would be according to the CPM. 

This shows that if they would have run ads for the same number of views, what would it cost?
Shows them that we are doing a better job, getting more organic views with less investment. 


Needs to be optional since there maybe launches for which this may not be the compelling metric to show. 






