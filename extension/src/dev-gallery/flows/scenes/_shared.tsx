import type { ReactNode } from 'react'
import { PanelHeader } from '../../../side-panel/components/PanelHeader'
import type { User } from '../../../shared/types'

const noop = () => undefined

interface ShellProps {
  user: User | null
  isEmbed?: boolean
  liveRemainingSecs?: number | null
  enabled?: boolean
  playbackSpeed?: number
  children: ReactNode
}

/**
 * Mirrors App.tsx's outer wrapper for embed/side-panel views — the
 * `flex flex-col h-screen bg-paper-100` column with PanelHeader on
 * top and arbitrary body below. Use this in every scene that
 * represents an authenticated UI state so the chrome is consistent.
 */
export function AppShell({
  user,
  isEmbed = true,
  liveRemainingSecs = null,
  enabled = true,
  playbackSpeed = 1.5,
  children,
}: ShellProps) {
  return (
    <div className="flex flex-col h-full bg-paper-100">
      <PanelHeader
        user={user}
        isEmbed={isEmbed}
        enabled={enabled}
        onToggleEnabled={noop}
        playbackSpeed={playbackSpeed}
        onSpeedChange={noop}
        liveRemainingSecs={liveRemainingSecs}
        onClose={noop}
        onLogout={noop}
      />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
