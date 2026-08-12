# Meta WhatsApp Cloud API Setup

This branch uses the **official Meta WhatsApp Cloud API** directly.
It avoids Twilio markup and does not need a VM/OpenWA runtime.

## What you must do

### 1) Create the Meta app

1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Create a new app of type **Business**.
3. Add the **WhatsApp** product to the app.

### 2) Connect business assets

1. Link the app to your Meta Business portfolio.
2. Create or select a **WhatsApp Business Account (WABA)**.
3. Add the school phone number you want to send from.
4. Complete phone verification.

### 3) Collect the required IDs

Save these values from the Meta dashboard:

- **App ID**
- **App Secret**
- **WABA ID**
- **Phone Number ID**

The API sends messages with the **Phone Number ID**.

### 4) Create WhatsApp templates

For absence alerts, create **utility templates**:

- English utility template
- Hindi utility template

Keep the text short and factual:

- student name
- class name
- attendance date
- absence reason prompt if needed

Templates must be approved before production sending.

### 5) Generate a permanent access token

Create a **System User** in Meta Business Manager and generate a long-lived access token with these permissions:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Store that token as a secret in Render.

### 6) Configure the API service

Set these environment variables on the Render API service:

```dotenv
META_WHATSAPP_ACCESS_TOKEN=...
META_WHATSAPP_PHONE_NUMBER_ID=...
META_WHATSAPP_APP_SECRET=...
META_WHATSAPP_VERIFY_TOKEN=...
META_WHATSAPP_WEBHOOK_URL=https://<your-api-host>/api/webhooks/meta-whatsapp
```

Optional:

```dotenv
META_WHATSAPP_WABA_ID=...
META_WHATSAPP_TEMPLATE_EN=student_absence_en
META_WHATSAPP_TEMPLATE_HI=student_absence_hi
```

### 7) Add webhook handling

Recommended, not strictly required for send-only use:

- verify webhook subscriptions
- capture delivery status callbacks
- mark messages as sent/failed from provider events

### 8) Deploy and test

1. Deploy the API with the new env vars.
2. Send one test alert to a staff-approved number.
3. Confirm the template is delivered.
4. Confirm the status callback updates the notification state.

## Cost for this project

For India utility alerts, the live page currently shows:

- **₹0.1150 per message**

So:

- **200 alerts/month = ₹23.00/month**

That is the Meta cost only.

## Notes

- No VM is needed.
- No Twilio markup is needed.
- If Meta changes the rate card, update the cost section here.
