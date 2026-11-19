# s3-upload

A full-stack task dashboard with S3 attachments and email messages.

## Database

Run `database/schema.sql` against MySQL. It creates the `todo_app` database and these tables:

- `todos`: task title, optional S3 file URL, and creation timestamp.
- `messages`: recipient fields, subject, body, direction, status, and creation timestamp.

## AWS setup

Copy `backend/.env.example` to `backend/.env` and configure MySQL, S3, SES, and SNS.

The backend uses `AWS_REGION` (default `ap-south-1`) and AWS credentials from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Backend environment variables:

- `PORT` (default `5000`)
- `FRONTEND_URL` (default `http://localhost:5173`)
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`, `SES_FROM_EMAIL`, `AWS_SNS_TOPIC_ARN`

Configure `frontend/.env` with `VITE_API_URL` if the API is not at `http://localhost:5000/api`.

For SES, set `SES_FROM_EMAIL` to a verified identity. In SES sandbox mode, both the sender and recipient identities must be verified, and sending is limited. Request production access and verify the sender domain/address before sending to unverified recipients.

For SNS notifications, create an SNS topic in the configured region and set `AWS_SNS_TOPIC_ARN` to its ARN. `POST /api/messages` publishes a JSON summary after SES accepts the email and MySQL stores the message. The summary includes `id`, `to`, `cc`, `bcc`, `subject`, and `sentAt`. An SNS topic being unset or SNS publish failing does not roll back or fail the email and MySQL operation; the API records the notification status in the response.

The existing S3 upload configuration is unchanged: set `AWS_S3_BUCKET` for task attachments.

## API

- `GET /api/health`
- `GET /api/todos`
- `POST /api/todos` (multipart form; `title`, optional `file`)
- `GET /api/messages`
- `POST /api/messages` (JSON: `to`, optional `cc`, optional `bcc`, `subject`, `body`)

## Verification

Run the backend API mock suite and frontend production build:

```bash
cd backend
npm test
npm start

cd ../frontend
npm run build
npm run dev
```
