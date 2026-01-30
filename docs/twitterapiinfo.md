Here are all the information about the external twitterapi.io

Understanding QPS Limits
QPS (Queries Per Second) limits determine the maximum number of API requests you can make per second. These limits are based on your
account balance to ensure fair usage and optimal performance for all users.
As your account balance increases, so does your QPS limit, allowing for higher throughput and more concurrent requests.
QPS Limits Table
Account Balance (Credits)
1000
5000
10000
50000
QPS Limit respectively
3
6
10
20
Tweets:
$0.15
per 1K tweets
Profiles:
$0.18
per 1K users
Followers:
$0.15
per 1K followers

API ENDPOINTS 

- to get information about an account 
const url = 'https://api.twitterapi.io/twitter/user/info';
const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}, body: undefined};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
response on 200 - {
  "data": {
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
  "status": "success",
  "msg": "<string>"
}

1  - to get information about a tweet 
 const url = 'https://api.twitterapi.io/twitter/tweets';
const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}, body: undefined};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}

response on 200 
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
      "quoted_tweet": {},
      "retweeted_tweet": {},
      "isLimitedReply": true
    }
  ],
  "status": "success",
  "message": "<string>"
}

2 - to get tweet replies 
const url = 'https://api.twitterapi.io/twitter/tweet/replies';
const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}, body: undefined};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}

response - 
{
  "replies": [
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
      "quoted_tweet": {},
      "retweeted_tweet": {},
      "isLimitedReply": true
    }
  ],
  "has_next_page": true,
  "next_cursor": "<string>",
  "status": "success",
  "message": "<string>"
}

3 - to get quote tweets 
const url = 'https://api.twitterapi.io/twitter/tweet/quotes';
const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}, body: undefined};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}

response - {
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
      "quoted_tweet": {},
      "retweeted_tweet": {},
      "isLimitedReply": true
    }
  ],
  "has_next_page": true,
  "next_cursor": "<string>",
  "status": "success",
  "message": "<string>"
}

4 - to get retweeters 
const url = 'https://api.twitterapi.io/twitter/tweet/retweeters';
const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}, body: undefined};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
 
 response - 
 {
  "users": [
    {
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
    }
  ],
  "has_next_page": true,
  "next_cursor": "<string>",
  "status": "success",
  "message": "<string>"
}