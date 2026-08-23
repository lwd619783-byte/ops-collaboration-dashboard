import { describe, expect, it } from 'vitest'
import { mapAuthInviteErrorForOperation } from './entry'

describe('Hosted invite reissue fail-closed mapping', () => {
  it.each([
    'user_already_exists',
    'email_exists',
    'identity_already_exists',
  ])(
    'keeps an existing-invitee reissue recoverable for provider conflict %s',
    (code) => {
      expect(
        mapAuthInviteErrorForOperation('existing_invitee_reissue', code),
      ).toBe('temporary_failure')
    },
  )

  it('preserves stable existing-user conflicts for a new Auth invite', () => {
    expect(
      mapAuthInviteErrorForOperation('new_auth_user_invite', 'email_exists'),
    ).toBe('email_exists')
  })

  it('does not hide unrelated provider failures during a reissue', () => {
    expect(
      mapAuthInviteErrorForOperation(
        'existing_invitee_reissue',
        'provider_failure',
      ),
    ).toBe('provider_failure')
  })
})
