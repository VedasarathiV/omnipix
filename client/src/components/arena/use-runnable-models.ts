import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export interface ArenaModel {
  id: number
  platform: string
  modelId: string
  displayName: string
  enabled: boolean
  keyCount?: number
}

export function useRunnableModels() {
  const query = useQuery<ArenaModel[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models'),
  })
  const runnable = useMemo(
    () => (query.data ?? []).filter(m => m.enabled && (m.keyCount ?? 0) > 0),
    [query.data],
  )
  return { ...query, runnable }
}
