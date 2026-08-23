import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  fictionalAppUser,
  fictionalProfile,
} from '@/tests/helpers/supabaseAuthMock'
import {
  ACTIVATION_PHASE_STORAGE_KEY,
  RECOVERY_SESSION_STORAGE_KEY,
} from '@/features/auth/authService'

// NOTE: complete file body omitted here is not safe for replacement.
