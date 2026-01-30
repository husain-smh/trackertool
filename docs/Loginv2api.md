Post & Action Endpoint V2(Back Online)
Log in
Log in directly using your email, username, password, and 2FA secret key. And obtain the Login_cookie, to post tweets, etc. Please note that the Login_cookie obtained through login_v2 can only be used for APIs with the “v2” suffix, such as create_tweet_v2. Trial operation price: $0.003 per call.

POST
/
twitter
/
user_login_v2

Try it
Authorizations
​
X-API-Key
stringheaderrequired
Body
application/json
​
user_name
stringrequired
User name.Must be set

​
email
stringrequired
Email.Must be set

​
password
stringrequired
The password of the user

​
proxy
stringrequired
The proxy to use.Please use high-quality residential proxies and avoid free proxies.Required.Example: http://username:password@ip:port . You can get proxy from: https://www.webshare.io/?referral_code=4e0q1n00a504

​
totp_secret
string
The totp secret of the user.If you don't have it, you can get it from the user's profile page.This field is required because it will make your login more reliable and less likely to be banned.

Response

200

application/json
Login response

​
login_cookie
string
The login cookie of the user.Use this cookie to post tweets, etc.You can only call v2 APIs with this cookie.If your account is in good standing and you're using residential proxies, the cookies will generally remain valid indefinitely.

​
status
string
Status of the request.success or error

​
msg
string
Message of the request.error message

Javascript implementation: 
const options = {
  method: 'POST',
  headers: {'X-API-Key': '<api-key>', 'Content-Type': 'application/json'},
  body: JSON.stringify({
    user_name: '<string>',
    email: '<string>',
    password: '<string>',
    proxy: '<string>',
    totp_secret: '<string>'
  })
};

fetch('https://api.twitterapi.io/twitter/user_login_v2', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));


200 response:
{
  "login_cookie": "<string>",
  "status": "<string>",
  "msg": "<string>"
}  