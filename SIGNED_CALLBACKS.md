# Signed callbacks for account authentication

Unsigned profile fields are not proof of a completed login. Consumers using this
service for account authentication must verify the signed callback protocol.

## Vercel settings

- `OAUTH_ASSERTION_PRIVATE_KEY`: a dedicated RSA private key, at least 2048 bits,
  in PKCS#8 PEM format. Store it only as a server environment secret. Actual
  newlines and literal `\n` sequences are supported.
- `OAUTH_ASSERTION_CALLBACKS`: a JSON array of exact HTTPS callback URLs, e.g.
  `["https://app.example/api/auth/oauth/callback"]`. Include production and any
  intended staging URLs explicitly.
- `OAUTH_ASSERTION_ISSUER`: optional; defaults to `https://oauth.lzc2002.top`.
  Consumers must configure the same exact issuer value when verifying assertions.

Give the matching SPKI PEM public key to each consumer backend, conventionally as
an `OAUTH_ASSERTION_PUBLIC_KEY` secret. Never share the private key with the browser.
No additional Vercel database or runtime dependency is required for signing.

For multiple consumers, list every exact callback while retaining one issuer key:

```json
[
  "https://app-one.example/api/oauth/callback",
  "https://app-two.example/api/oauth/callback"
]
```

Each consumer receives the same public key and verifies only its own callback as
the assertion audience. Public keys are not secrets; distributing the public key
does not allow a consumer to create assertions.

## Generate a signing key pair

Generate an RSA key of at least 2048 bits; 3072 bits is a suitable default:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out oauth-assertion-private.pem
openssl pkey -in oauth-assertion-private.pem -pubout -out oauth-assertion-public.pem
```

Paste the complete `oauth-assertion-private.pem`, including its header and footer,
into the Vercel `OAUTH_ASSERTION_PRIVATE_KEY` environment variable. Paste the
complete `oauth-assertion-public.pem` into each consumer backend's verification
key setting. Never commit the private key or expose it to browser code.

To confirm that two files form one pair, these commands must produce the same
SHA-256 value:

```sh
openssl pkey -in oauth-assertion-private.pem -pubout -outform DER | openssl dgst -sha256
openssl pkey -pubin -in oauth-assertion-public.pem -outform DER | openssl dgst -sha256
```

## Add another consumer

1. Give the consumer the current public key.
2. Add its exact HTTPS callback to `OAUTH_ASSERTION_CALLBACKS`.
3. Implement signature, issuer, audience, lifetime, provider, and ticket checks on
   that consumer's backend.
4. Deploy the consumer, then redeploy this Vercel project with the extended
   callback list.
5. Test login, rejection of a different audience, ticket replay, expiration, and
   cancellation before enabling account binding.

Unsigned callbacks and direct JSON delivery do not need to appear in
`OAUTH_ASSERTION_CALLBACKS`, but they are unsuitable as identity proof.

## Rotate the issuer key

The current service signs all configured consumers with one private key and does
not emit a JWT `kid`. Rotation is therefore coordinated:

1. Generate a new pair with new filenames; retain the old pair until rollout is
   complete.
2. Schedule a short maintenance window for signed authentication.
3. Replace the verification public key in every consumer.
4. Replace `OAUTH_ASSERTION_PRIVATE_KEY` in Vercel and redeploy this project.
5. Verify every callback, then securely remove obsolete private-key copies.

Changing only one side causes signed authentication to fail. Independent
per-consumer keys or overlap between old and new keys requires a future keyring
and `kid` implementation.

For configured destinations, the shared `buildPostForm` helper replaces ordinary
profile fields with one `assertion` field. All existing form-based provider
adapters use this helper. Signing occurs after the provider token exchange and
profile retrieval. Missing keys or invalid identity fields fail closed for those
destinations. Other consumers retain their existing response contract, which must
not be treated as cryptographic identity proof.

The RS256 JWT includes `iss`, `aud` (exact callback URL), `sub`, `platform`, `nonce`
(the consumer ticket transported as OAuth `state`), `iat`, `exp` (120 seconds),
`jti`, and limited profile fields. Provider tokens and `originalResponse` are
never included. Large/base64 avatars are omitted; only bounded HTTPS avatar URLs
are included. Provider adapters do expose `originalResponse` in their normalized
legacy/direct result, where it contains the provider-specific raw profile object.

The consumer must verify signature, algorithm, issuer, audience, lifetime, and a
server-created ticket tied to the initiating browser and operation. It must
redeem that ticket atomically. Signature verification alone does not prevent
replay or login CSRF. Each consumer must provide shared, durable ticket storage
with atomic attachment and redemption; suitable implementations include
SQLite-backed Durable Objects, PostgreSQL, or Redis.

Use a coordinated deployment window: every consumer must reject unsigned callbacks
even when the issuer is unavailable. Do not leave old raw-identity login or binding
endpoints active after enabling signed delivery. Existing sessions are a separate
incident-response concern.

Run `npm test` for signing, configuration failure, UTF-8 claims, preservation of
other consumers' format, and actual form delivery checks. Live provider exchanges
and browser redirects still need deployment verification.
