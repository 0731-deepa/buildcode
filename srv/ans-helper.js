// srv/ans-helper.js
const axios = require("axios");

function getAnsCredentials() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || "{}");
  const svc  = (vcap["alert-notification"] || [])[0];
  if (!svc) throw new Error("ANS service binding not found");
  return svc.credentials;  // { url, oauth_url, client_id, client_secret }
}

async function getToken(creds) {
  const resp = await axios.post(
    `${creds.oauth_url}/oauth/token`,
    "grant_type=client_credentials",
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: creds.client_id, password: creds.client_secret }
    }
  );
  return resp.data.access_token;
}

async function sendAlert(event) {
  const creds = getAnsCredentials();
  const token = await getToken(creds);
  await axios.post(
    `${creds.url}/cf/producer/v1/resource-events`,
    event,
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
}

module.exports = { sendAlert };
