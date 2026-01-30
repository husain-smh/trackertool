Send DM V2
Send a direct message to a user.You must set the login_cookie..You can get the login_cookie from /twitter/user_login_v2.You can only send DMs to those who have enabled DMs. Sometimes it may fail, so be prepared to retry.Trial operation price: $0.003 per call.

POST
/
twitter
/
send_dm_to_user

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Body
application/json
​
login_cookies
stringrequired
The login cookie of the user.You can get the login_cookies from /twitter/user_login_v2.Must be set

​
user_id
stringrequired
The id of the user to send the direct message to.Must be set

​
text
stringrequired
The text of the direct message.Must be set

​
proxy
stringrequired
The proxy to use.Please use high-quality residential proxies and avoid free proxies.Required.Example: http://username:password@ip:port . You can get proxy from: https://www.webshare.io/?referral_code=4e0q1n00a504

​
media_ids
array
The ids of the media to post.Optional.You can get the media_ids from /twitter/upload_image_v2 (to be developed)

​
reply_to_message_id
string
The id of the message to reply to.Optional

Response

200

application/json
Login response

​
message_id
string
The id of the sent direct message.

​
status
string
Status of the request.success or error

​
msg
string
Message of the request.error message


How to implement in js:
const options = {
  method: 'POST',
  headers: {'X-API-Key': '<api-key>', 'Content-Type': 'application/json'},
  body: JSON.stringify({
    login_cookies: '<string>',
    user_id: '<string>',
    text: '<string>',
    proxy: '<string>',
    media_ids: '<array>',
    reply_to_message_id: '<string>'
  })
};

fetch('https://api.twitterapi.io/twitter/send_dm_to_user', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));

  200 response example - {
  "message_id": "<string>",
  "status": "<string>",
  "msg": "<string>"
}