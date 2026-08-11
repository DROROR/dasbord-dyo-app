import { Building2 } from 'lucide-react'

// Single shared renderer for every task-card variant (VerticalBoard,
// MyBoard's grouped rows AND its alert banners, GanttTab) so a task's
// client never silently disappears depending on which surface it's
// shown on — the root cause of the original bug was never a data or
// mapping problem (dbToTask/taskToRow have always round-tripped
// client_id/client_name correctly), it was that this badge had only
// ever been added to two of the several card renderers. Renders
// nothing at all when there's no name — never an empty placeholder.
export function ClientBadge({ name }: { name?: string }) {
  if (!name) return null
  return (
    <span className="flex items-center gap-1 text-[9px] bg-secondary/15 text-secondary-dark px-1.5 py-0.5 rounded font-semibold shrink-0">
      <Building2 size={9} className="shrink-0" />
      {name}
    </span>
  )
}
