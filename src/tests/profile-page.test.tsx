import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  fictionalProfile,
} from '@/tests/helpers/supabaseAuthMock'

function renderProfile(
  options: Parameters<typeof createSupabaseClientMock>[0] = {},
) {
  const supabase = createSupabaseClientMock({ hasSession: true, ...options })
  render(
    <AuthProvider
      resolveClient={() => ({ status: 'ready', client: supabase.client })}
    >
      <MemoryRouter initialEntries={['/settings']}>
        <AppRouter />
      </MemoryRouter>
    </AuthProvider>,
  )
  return supabase
}

describe('个人资料页', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('显示当前用户资料并可保存', async () => {
    const supabase = renderProfile()
    const displayName = await screen.findByLabelText(/显示名称/)
    expect(displayName).toHaveValue(fictionalProfile.display_name)
    expect(screen.getByLabelText(/组织名称/)).toHaveValue(
      fictionalProfile.organization_name,
    )
    expect(screen.getByLabelText(/职位/)).toHaveValue(fictionalProfile.title)

    const user = userEvent.setup()
    await user.clear(displayName)
    await user.type(displayName, 'Updated Name')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    expect(await screen.findByText('个人资料已保存。')).toBeInTheDocument()
    expect(supabase.from).toHaveBeenCalledWith('profiles')
  })

  it('表单提交不含 user_id / created_at / updated_at', async () => {
    const supabase = renderProfile()
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    await user.clear(displayName)
    await user.type(displayName, 'Another Name')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    await screen.findByText('个人资料已保存。')
    const profileQuery = supabase.from.mock.results.find(
      (result) =>
        result.type === 'return' &&
        typeof result.value?.update?.mock?.calls?.length === 'number' &&
        result.value.update.mock.calls.length > 0,
    )
    const payload = profileQuery?.value.update.mock.calls[0][0]
    expect(payload).toEqual({
      display_name: 'Another Name',
      organization_name: 'Fictional Org',
      title: 'Fictional Title',
    })
    expect(payload).not.toHaveProperty('user_id')
    expect(payload).not.toHaveProperty('created_at')
    expect(payload).not.toHaveProperty('updated_at')
    expect(payload).not.toHaveProperty('contact_info')
  })

  it('显示名称去除首尾空白', async () => {
    const supabase = renderProfile()
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    await user.clear(displayName)
    await user.type(displayName, '  Trimmed Name  ')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    await screen.findByText('个人资料已保存。')
    const profileQuery = supabase.from.mock.results.find(
      (result) =>
        result.type === 'return' &&
        typeof result.value?.update?.mock?.calls?.length === 'number' &&
        result.value.update.mock.calls.length > 0,
    )
    const payload = profileQuery?.value.update.mock.calls[0][0]
    expect(payload?.display_name).toBe('Trimmed Name')
  })

  it('空显示名称被拒绝且不调用更新', async () => {
    const supabase = renderProfile()
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    await user.clear(displayName)
    const form = document.querySelector('form.profile-form')
    expect(form).not.toBeNull()
    if (form) fireEvent.submit(form)

    expect(screen.getByText('显示名称不能为空。')).toBeInTheDocument()
    const updateCalls = supabase.from.mock.results
      .filter((r) => r.type === 'return')
      .map((r) => r.value?.update)
      .filter((u) => typeof u?.mock?.calls?.length === 'number')
    expect(updateCalls.every((u) => u.mock.calls.length === 0)).toBe(true)
  })

  it('超长显示名称被前端拒绝', async () => {
    const supabase = renderProfile()
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    await user.clear(displayName)
    await user.type(displayName, 'x'.repeat(121))
    const form = document.querySelector('form.profile-form')
    expect(form).not.toBeNull()
    if (form) fireEvent.submit(form)

    expect(
      screen.getByText('显示名称不能超过 120 个字符。'),
    ).toBeInTheDocument()
    const updateCalls = supabase.from.mock.results
      .filter((r) => r.type === 'return')
      .map((r) => r.value?.update)
      .filter((u) => typeof u?.mock?.calls?.length === 'number')
    expect(updateCalls.every((u) => u.mock.calls.length === 0)).toBe(true)
  })

  it('profile 更新失败显示安全错误', async () => {
    renderProfile({
      profileUpdateError: {
        code: 'unknown',
        message: 'secret db error',
        name: 'PostgrestError',
      },
    })
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    await user.clear(displayName)
    await user.type(displayName, 'Another Name')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    expect(
      await screen.findByText('无法保存个人资料，请稍后重试。'),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('secret db error')
  })

  it('字段标签可用于辅助技术定位', async () => {
    renderProfile()
    const displayName = await screen.findByLabelText(/显示名称/)
    expect(displayName).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText(/组织名称/)).toHaveAttribute(
      'autocomplete',
      'organization',
    )
    expect(screen.getByLabelText(/职位/)).toHaveAttribute(
      'autocomplete',
      'organization-title',
    )
  })

  it('键盘可以完成资料保存操作', async () => {
    renderProfile()
    const user = userEvent.setup()
    const displayName = await screen.findByLabelText(/显示名称/)
    displayName.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.keyboard('Keyboard Name')
    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(screen.getByText('个人资料已保存。')).toBeInTheDocument(),
    )
  })
})
