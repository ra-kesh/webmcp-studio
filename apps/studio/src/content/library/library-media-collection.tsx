import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactNode, RefCallback } from "react"
import type { LibraryMediaSummary } from "@webmcp/document"
import { libraryMediaUiIdentity } from "./library-media-discovery"

export const LIBRARY_MEDIA_VIRTUALIZATION_THRESHOLD = 48

export type LibraryMediaCollectionSourceGroup = Readonly<{
  label: string
  items: readonly LibraryMediaSummary[]
}>

export type LibraryMediaCollectionAuthority = "server" | "local"

export type LibraryMediaCollectionCardRef = RefCallback<HTMLButtonElement>

export type LibraryMediaCollectionCardRenderProps = Readonly<{
  item: LibraryMediaSummary
  identity: string
  authority: LibraryMediaCollectionAuthority
  groupLabel: string
  selected: boolean
  focused: boolean
  semanticPosition: Readonly<{ position: number; size: number }>
  cardRef: LibraryMediaCollectionCardRef
  onFocus: () => void
}>

export type LibraryMediaCollectionProps = Readonly<{
  serverGroup: LibraryMediaCollectionSourceGroup
  localGroup?: LibraryMediaCollectionSourceGroup | null
  density?: "comfortable" | "compact"
  selectedIdentity?: string | null
  focusedIdentity?: string | null
  forceFocusIdentity?: boolean
  getScrollElement: () => HTMLElement | null
  renderCard: (props: LibraryMediaCollectionCardRenderProps) => ReactNode
  renderServerLoadMore?: () => ReactNode
  renderServerFinalStatus?: () => ReactNode
  onCardFocus?: (
    identity: string,
    index: number,
    authority: LibraryMediaCollectionAuthority
  ) => void
  onCollectionFocusLeave?: () => void
  onFocusIntentHandled?: () => void
}>

type ActiveGroup = Readonly<{
  authority: LibraryMediaCollectionAuthority
  label: string
  items: readonly LibraryMediaSummary[]
}>

type HeaderRow = Readonly<{
  kind: "header"
  authority: LibraryMediaCollectionAuthority
}>

type ItemRow = Readonly<{
  kind: "items"
  authority: LibraryMediaCollectionAuthority
  start: number
  items: readonly LibraryMediaSummary[]
}>

type CollectionRow = HeaderRow | ItemRow

const columnCountForWidth = (width: number) => {
  if (width >= 860) return 4
  if (width >= 620) return 3
  if (width >= 360) return 2
  return 1
}

function useContainerColumns() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(1)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = (width: number) =>
      setColumns((current) => {
        const next = columnCountForWidth(width)
        return current === next ? current : next
      })

    update(host.getBoundingClientRect().width)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      update(entry.contentRect.width)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return { columns, hostRef }
}

const acceptedItems = (
  authority: LibraryMediaCollectionAuthority,
  items: readonly LibraryMediaSummary[]
) =>
  items.filter((item) =>
    authority === "local"
      ? item.mediaSource === "local"
      : item.mediaSource !== "local"
  )

const rowsFor = (groups: readonly ActiveGroup[], columns: number) => {
  const rows: CollectionRow[] = []
  for (const group of groups) {
    rows.push({ kind: "header", authority: group.authority })
    for (let start = 0; start < group.items.length; start += columns) {
      rows.push({
        kind: "items",
        authority: group.authority,
        start,
        items: group.items.slice(start, start + columns),
      })
    }
  }
  return rows
}

const rowKey = (row: CollectionRow, columns: number) => {
  if (row.kind === "header") return `media-group:${row.authority}`
  const first = row.items[0]
  return `media-row:${row.authority}:${libraryMediaUiIdentity(first)}:${columns}`
}

export function LibraryMediaCollection({
  serverGroup,
  localGroup = null,
  density = "compact",
  selectedIdentity = null,
  focusedIdentity = null,
  forceFocusIdentity = false,
  getScrollElement,
  renderCard,
  renderServerLoadMore,
  renderServerFinalStatus,
  onCardFocus,
  onCollectionFocusLeave,
  onFocusIntentHandled,
}: LibraryMediaCollectionProps) {
  const instanceId = useId()
  const { columns, hostRef } = useContainerColumns()
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const retainedCollectionFocus = useRef(false)
  const [scrollMargin, setScrollMargin] = useState(0)

  const groups = useMemo<readonly ActiveGroup[]>(() => {
    const serverItems = acceptedItems("server", serverGroup.items)
    const localItems = localGroup
      ? acceptedItems("local", localGroup.items)
      : []
    const next: ActiveGroup[] = []
    if (serverItems.length > 0) {
      next.push({
        authority: "server",
        label: serverGroup.label,
        items: serverItems,
      })
    }
    if (localGroup && localItems.length > 0) {
      next.push({
        authority: "local",
        label: localGroup.label,
        items: localItems,
      })
    }
    return next
  }, [localGroup, serverGroup])

  const itemCount = groups.reduce(
    (total, group) => total + group.items.length,
    0
  )
  const virtualized = itemCount > LIBRARY_MEDIA_VIRTUALIZATION_THRESHOLD
  const rows = useMemo(() => rowsFor(groups, columns), [columns, groups])
  const rowByIdentity = useMemo(() => {
    const result = new Map<string, number>()
    rows.forEach((row, rowIndex) => {
      if (row.kind !== "items") return
      for (const item of row.items) {
        result.set(libraryMediaUiIdentity(item), rowIndex)
      }
    })
    return result
  }, [rows])
  const selectedRow = selectedIdentity
    ? (rowByIdentity.get(selectedIdentity) ?? -1)
    : -1
  const focusedRow = focusedIdentity
    ? (rowByIdentity.get(focusedIdentity) ?? -1)
    : -1
  const headerRows = useMemo(
    () => rows.flatMap((row, index) => (row.kind === "header" ? [index] : [])),
    [rows]
  )

  useLayoutEffect(() => {
    if (!virtualized) {
      setScrollMargin(0)
      return
    }
    const host = hostRef.current
    const scrollElement = getScrollElement()
    if (!host || !scrollElement) return
    const hostRect = host.getBoundingClientRect()
    const scrollRect = scrollElement.getBoundingClientRect()
    const next = hostRect.top - scrollRect.top + scrollElement.scrollTop
    setScrollMargin((current) => (current === next ? current : next))
  })

  const virtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    estimateSize: (index) =>
      rows[index]?.kind === "header" ? 32 : density === "compact" ? 248 : 280,
    getScrollElement,
    getItemKey: (index) => rowKey(rows[index], columns),
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range))
      for (const headerRow of headerRows) indexes.add(headerRow)
      if (selectedRow >= 0) indexes.add(selectedRow)
      if (focusedRow >= 0) indexes.add(focusedRow)
      return [...indexes].sort((left, right) => left - right)
    },
    scrollMargin,
    useFlushSync: false,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const virtualSignature = virtualRows.map((row) => row.key).join("|")

  const registerCard = useCallback(
    (identity: string): LibraryMediaCollectionCardRef =>
      (node) => {
        if (node) cardRefs.current.set(identity, node)
        else cardRefs.current.delete(identity)
      },
    []
  )

  useEffect(() => {
    if (!focusedIdentity || focusedRow < 0) return
    if (!forceFocusIdentity && !retainedCollectionFocus.current) return
    if (virtualized) virtualizer.scrollToIndex(focusedRow, { align: "auto" })
    const frame = requestAnimationFrame(() => {
      const node = cardRefs.current.get(focusedIdentity)
      if (!node) return
      node.focus({ preventScroll: true })
      onFocusIntentHandled?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    columns,
    focusedIdentity,
    focusedRow,
    forceFocusIdentity,
    onFocusIntentHandled,
    virtualSignature,
    virtualized,
    virtualizer,
  ])

  const headingId = (authority: LibraryMediaCollectionAuthority) =>
    `${instanceId}-${authority}-media-heading`

  const renderItem = (
    group: ActiveGroup,
    item: LibraryMediaSummary,
    index: number
  ) => {
    const identity = libraryMediaUiIdentity(item)
    return renderCard({
      item,
      identity,
      authority: group.authority,
      groupLabel: group.label,
      selected: selectedIdentity === identity,
      focused: focusedIdentity === identity,
      semanticPosition: { position: index + 1, size: group.items.length },
      cardRef: registerCard(identity),
      onFocus: () => {
        retainedCollectionFocus.current = true
        onCardFocus?.(identity, index, group.authority)
      },
    })
  }

  const serverPagination =
    renderServerLoadMore || renderServerFinalStatus ? (
      <div className="mt-3" data-media-server-pagination="true">
        {renderServerLoadMore?.()}
        {renderServerFinalStatus?.()}
      </div>
    ) : null

  return (
    <div
      ref={hostRef}
      className="min-w-0"
      data-library-media-grid-host="true"
      data-library-media-virtualized={virtualized ? "true" : undefined}
      onFocusCapture={() => {
        retainedCollectionFocus.current = true
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        )
          return
        retainedCollectionFocus.current = false
        onCollectionFocusLeave?.()
      }}
    >
      {virtualized ? (
        <div
          className="relative w-full"
          data-library-media-virtual-content="true"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {groups.map((group) => {
            const groupRows = virtualRows.filter(
              (virtualRow) =>
                rows[virtualRow.index]?.authority === group.authority
            )
            return (
              <section
                aria-labelledby={headingId(group.authority)}
                className="contents"
                data-media-group={group.authority}
                key={group.authority}
              >
                {groupRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  const translateY = virtualRow.start - scrollMargin
                  if (row.kind === "header") {
                    return (
                      <h2
                        className="absolute top-0 left-0 flex h-8 w-full items-end pb-2 text-[11px] font-medium tracking-wide text-muted-foreground"
                        data-index={virtualRow.index}
                        id={headingId(group.authority)}
                        key={virtualRow.key}
                        ref={virtualizer.measureElement}
                        style={{ transform: `translateY(${translateY}px)` }}
                      >
                        {group.label}
                      </h2>
                    )
                  }
                  return null
                })}
                <div
                  aria-labelledby={headingId(group.authority)}
                  className="contents"
                  role="list"
                >
                  {groupRows.map((virtualRow) => {
                    const row = rows[virtualRow.index]
                    if (row.kind !== "items") return null
                    const translateY = virtualRow.start - scrollMargin
                    return (
                      <div
                        className="absolute top-0 left-0 grid w-full gap-3 pb-3"
                        data-index={virtualRow.index}
                        data-library-media-virtual-row={virtualRow.index}
                        key={virtualRow.key}
                        ref={virtualizer.measureElement}
                        role="presentation"
                        style={{
                          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                          transform: `translateY(${translateY}px)`,
                        }}
                      >
                        {row.items.map((item, offset) => {
                          const index = row.start + offset
                          return (
                            <div
                              aria-posinset={index + 1}
                              aria-setsize={group.items.length}
                              className="min-w-0"
                              key={libraryMediaUiIdentity(item)}
                              role="listitem"
                            >
                              {renderItem(group, item, index)}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        groups.map((group) => (
          <section
            aria-labelledby={headingId(group.authority)}
            className="not-first:mt-5"
            data-media-group={group.authority}
            key={group.authority}
          >
            <h2
              className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground"
              id={headingId(group.authority)}
            >
              {group.label}
            </h2>
            <ul
              aria-labelledby={headingId(group.authority)}
              className="grid gap-3"
              data-library-media-semantic-list={group.authority}
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {group.items.map((item, index) => (
                <li
                  aria-posinset={index + 1}
                  aria-setsize={group.items.length}
                  className="min-w-0"
                  key={libraryMediaUiIdentity(item)}
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize:
                      density === "compact" ? "0 248px" : "0 280px",
                  }}
                >
                  {renderItem(group, item, index)}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {serverPagination}
    </div>
  )
}
