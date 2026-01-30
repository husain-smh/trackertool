Advanced Search
Advanced search for tweets.Each page returns up to 20 replies(Sometimes less than 20,because we will filter out ads or other not tweets). Use cursor for pagination.

GET
/
twitter
/
tweet
/
advanced_search

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Query Parameters
​
query
string<string>required
The query to search for.eg. "AI" OR "Twitter" from:elonmusk since:2021-12-31_23:59:59_UTC . Get more examples from https://github.com/igorbrigadir/twitter-advanced-search

​
queryType
enum<string>default:Latestrequired
The query type to search for.eg. "Latest" OR "Top"

Available options: Latest, Top 
​
cursor
string<string>
The cursor to paginate through the results. First page is "".

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

const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}};

fetch('https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));

result 200 :
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
  "next_cursor": "<string>"
}