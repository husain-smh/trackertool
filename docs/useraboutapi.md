Get User Profile About
Get user profile about by screen name

GET
/
twitter
/
user_about

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Query Parameters
​
userName
string<string>
The screen name of the user

Response

200

application/json
User info

​
data
object
Show child attributes



curl - curl --request GET \
  --url https://api.twitterapi.io/twitter/user_about \
  --header 'X-API-Key: <api-key>'


javascript:

const options = {method: 'GET', headers: {'X-API-Key': '<api-key>'}};

fetch('https://api.twitterapi.io/twitter/user_about', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));


Response 200:

{
  "data": {
    "id": "<string>",
    "name": "<string>",
    "userName": "<string>",
    "createdAt": "<string>",
    "isBlueVerified": true,
    "protected": true,
    "affiliates_highlighted_label": {
      "label": {
        "badge": {
          "url": "<string>"
        },
        "description": "<string>",
        "url": {
          "url": "<string>",
          "urlType": "<string>"
        },
        "userLabelDisplayType": "<string>",
        "userLabelType": "<string>"
      }
    },
    "about_profile": {
      "account_based_in": "<string>",
      "location_accurate": true,
      "learn_more_url": "<string>",
      "affiliate_username": "<string>",
      "source": "<string>",
      "username_changes": {
        "count": "<string>"
      }
    },
    "identity_profile_labels_highlighted_label": {
      "label": {
        "description": "<string>",
        "badge": {
          "url": "<string>"
        },
        "url": {
          "url": "<string>",
          "urlType": "<string>"
        },
        "userLabelDisplayType": "<string>",
        "userLabelType": "<string>"
      }
    }
  },
  "status": "success",
  "msg": "<string>"
}


exmple response: 
[
  {
    "status": "success",
    "msg": "success",
    "data": {
      "id": "1552619125780148226",
      "name": "whosane",
      "userName": "who_is_sane",
      "createdAt": "2022-07-28T11:37:25.000000Z",
      "affiliates_highlighted_label": {},
      "isBlueVerified": true,
      "protected": false,
      "about_profile": {
        "account_based_in": "South Asia",
        "location_accurate": true,
        "learn_more_url": "https://help.twitter.com/managing-your-account/about-twitter-verified-accounts",
        "source": "South Asia Android App",
        "username_changes": {
          "count": "2",
          "last_changed_at_msec": "1738874288438"
        }
      },
      "identity_profile_labels_highlighted_label": {}
    }
  }
]