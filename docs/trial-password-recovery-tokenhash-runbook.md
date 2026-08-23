# Trial Password Recovery TokenHash Runbook

## 1. Purpose

This runbook closes the Trial password-recovery failure where a PKCE reset link
is opened in a different browser/device or an email-app WebView and the browser
cannot complete the original code-verifier exchange.

The remediation keeps the global Supabase client on PKCE. Only password-recovery
email handling changes to a user-controlled TokenHash confirmation boundary:

```text
request reset
  -> Recovery email
  -> /auth/recovery?token_hash=...&type=recovery
  -> explicit user click
  -> verifyOtp(type=recovery)
  -> verified recovery session
  -> /reset-password
  -> update password
```

Merely loading `/auth/recovery` MUST NOT verify or consume the one-time token.

## 2. Preconditions

Do not change the hosted Recovery email template until all of the following are
true:

1. the reviewed ISSUE-001 code has been merged to `main`;
2. the exact merged `main` has deployed successfully to the Trial Vercel target;
3. `https://ops-collaboration-dashboard-trial.vercel.app/auth/recovery` serves
   the new confirmation page;
4. the Trial Supabase Auth Site URL is the Trial application origin, not a local
   development origin;
5. no Production Auth configuration is being modified.

## 3. Hosted Trial email-template change

In the **Trial** Supabase project only, open:

`Authentication -> Email Templates -> Reset Password`

Use the version-controlled template in:

`supabase/templates/recovery.html`

The security-relevant link must remain equivalent to:

```html
<a href="{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery">
  继续重置密码
</a>
```

Do not replace this with `{{ .ConfirmationURL }}`. The TokenHash is intentionally
sent to an application page that performs no verification on GET; verification
only happens after the user explicitly clicks the confirmation button.

Do not paste access tokens, database passwords, service-role keys, SMTP
passwords, real reset links, or real user email addresses into repository files,
PRs, Issues, Actions logs, or screenshots.

## 4. Required Trial verification

Use controlled test accounts and record only sanitized evidence.

At minimum verify:

1. desktop browser requests reset -> same desktop browser opens latest email;
2. desktop browser requests reset -> phone browser/WebView opens latest email;
3. phone requests reset -> desktop browser opens latest email;
4. merely opening the confirmation URL does not consume the token;
5. explicit `继续重置密码` establishes the recovery session and opens the new
   password form;
6. password update succeeds and the recovery session is cleared/signs out;
7. the old/used token is rejected;
8. an actually expired token is rejected with safe copy;
9. after multiple reset requests, only the newest email is used;
10. no raw Supabase error, token hash, access token, refresh token, or internal
    identity detail is rendered or logged.

For the previously failing cross-device class, Supabase Auth logs should show a
successful OTP verification/session creation rather than a `/verify` redirect
that never completes the PKCE `/token` exchange.

## 5. Admission / issue status

ISSUE-001 remains **处理中** until the hosted Trial template is switched and the
cross-browser/device verification above passes.

After successful Trial verification, move it to **待复核**. It becomes **已关闭**
only after the independent code/config review confirms the exact merged SHA,
Trial deployment and sanitized verification evidence.

Do not proceed to a new Major issue merely because the code branch builds.

## 6. Rollback

If the new flow fails after the hosted template switch:

1. stop sending further recovery emails while investigating;
2. restore the previously recorded Trial Recovery email template;
3. leave database schema/data unchanged — this remediation requires no database
   migration;
4. keep ISSUE-001 open and record the sanitized failure class;
5. do not weaken RLS, disable PKCE globally, expose high-privilege credentials,
   or switch Production settings as a workaround.
