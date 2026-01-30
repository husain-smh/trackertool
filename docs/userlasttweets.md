User Endpoint
Get User Last Tweets
Retrieve tweets by user name.Sort by created_at. Results are paginated, with each page returning up to 20 tweets.If you only need to fetch the latest tweets from a single user very frequently, do not use this API—it will cost you a lot. Instead, please refer to https://twitterapi.io/blog/how-to-monitor-twitter-accounts-for-new-tweets-in-real-time. If you have more than 20 Twitter accounts requiring real-time tweet updates, use https://twitterapi.io/twitter-stream which is the most cost-effective solution.

GET
/
twitter
/
user
/
last_tweets

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Query Parameters
​
userId
string<string>
user id of the user.userId is recommended, could be more stable and faster than userName.userId and userName are mutually exclusive. If both are provided, userId will be used.

​
userName
string<string>
screen name of the user.userId and userName are mutually exclusive. If both are provided, userId will be used.

​
cursor
string<string>
The cursor to paginate through the results. First page is "".

​
includeReplies
booleandefault:false
Whether to include replies in the results. Default is False.

Response

200

application/json
Tweets response

​
tweets
object[]required
Array of tweets

Show child attributes

​
has_next_page
booleanrequired
Indicates if there are more results available

​
next_cursor
stringrequired
Cursor for fetching the next page of results

​
status
enum<string>required
Status of the request.success or error

Available options: success, error 
​
message
stringrequired
Message of the request.error message

const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}};

fetch('https://api.twitterapi.io/twitter/user/last_tweets', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));

  {
  "tweets": [
    {
      "type": "tweet",
      "id": "<string>",
      "url": "<string>",
      "text": "<string>",
      "source": "<string>",
      "retweetCount": 123,
      "replyCount": 123,
      "likeCount": 123,
      "quoteCount": 123,
      "viewCount": 123,
      "createdAt": "<string>",
      "lang": "<string>",
      "bookmarkCount": 123,
      "isReply": true,
      "inReplyToId": "<string>",
      "conversationId": "<string>",
      "displayTextRange": [
        123
      ],
      "inReplyToUserId": "<string>",
      "inReplyToUsername": "<string>",
      "author": {
        "type": "user",
        "userName": "<string>",
        "url": "<string>",
        "id": "<string>",
        "name": "<string>",
        "isBlueVerified": true,
        "verifiedType": "<string>",
        "profilePicture": "<string>",
        "coverPicture": "<string>",
        "description": "<string>",
        "location": "<string>",
        "followers": 123,
        "following": 123,
        "canDm": true,
        "createdAt": "<string>",
        "favouritesCount": 123,
        "hasCustomTimelines": true,
        "isTranslator": true,
        "mediaCount": 123,
        "statusesCount": 123,
        "withheldInCountries": [
          "<string>"
        ],
        "affiliatesHighlightedLabel": {},
        "possiblySensitive": true,
        "pinnedTweetIds": [
          "<string>"
        ],
        "isAutomated": true,
        "automatedBy": "<string>",
        "unavailable": true,
        "message": "<string>",
        "unavailableReason": "<string>",
        "profile_bio": {
          "description": "<string>",
          "entities": {
            "description": {
              "urls": [
                {
                  "display_url": "<string>",
                  "expanded_url": "<string>",
                  "indices": [
                    123
                  ],
                  "url": "<string>"
                }
              ]
            },
            "url": {
              "urls": [
                {
                  "display_url": "<string>",
                  "expanded_url": "<string>",
                  "indices": [
                    123
                  ],
                  "url": "<string>"
                }
              ]
            }
          }
        }
      },
      "entities": {
        "hashtags": [
          {
            "indices": [
              123
            ],
            "text": "<string>"
          }
        ],
        "urls": [
          {
            "display_url": "<string>",
            "expanded_url": "<string>",
            "indices": [
              123
            ],
            "url": "<string>"
          }
        ],
        "user_mentions": [
          {
            "id_str": "<string>",
            "name": "<string>",
            "screen_name": "<string>"
          }
        ]
      },
      "quoted_tweet": "<unknown>",
      "retweeted_tweet": "<unknown>",
      "isLimitedReply": true
    }
  ],
  "has_next_page": true,
  "next_cursor": "<string>",
  "status": "success",
  "message": "<string>"
}