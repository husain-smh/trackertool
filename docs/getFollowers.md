Get User Followers
Get user followers in reverse chronological order (newest first). Returns exactly 200 followers per page, sorted by follow date. Most recent followers appear on the first page. Use cursor for pagination through the complete followers list.

GET
/
twitter
/
user
/
followers

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Query Parameters
​
userName
string<string>required
screen name of the user

​
cursor
string<string>
The cursor to paginate through the results. First page is "".

​
pageSize
integerdefault:200
The number of followings to return per page. Default is 200.min 20,max 200

Response

200

application/json
User info

​
followers
object[]
Array of followers

Show child attributes

​
status
enum<string>
Status of the request.success or error

Available options: success, error 
​
message
string
Message of the request.error message

Get User Last Tweets
Get User Followings

const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}};

fetch('https://api.twitterapi.io/twitter/user/followers?pageSize=200', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));


  200 result :
  {
  "followers": [
    {
      "type": "user",
      "userName": "<string>",
      "url": "<string>",
      "id": "<string>",
      "name": "<string>",
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
    }
  ],
  "status": "success",
  "message": "<string>"
}