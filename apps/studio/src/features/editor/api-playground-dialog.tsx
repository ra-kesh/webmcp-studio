import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Clipboard,
  Code2,
  Download,
  History,
  LoaderCircle,
  Play,
  RotateCw,
} from "lucide-react"
import type {
  FieldValue,
  TemplateModifications,
  TemplateParameter,
  TemplateVersion,
} from "@webmcp/document"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { Checkbox } from "@webmcp/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@webmcp/ui/components/field"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"
import type {
  RenderHistoryController,
  RenderSelection,
} from "./use-render-history"
import { studioAssets } from "./asset-catalog"
import { TypedFieldValueControl } from "./typed-field-value-control"

type OutputChoice = {
  selected: boolean
  format: "png" | "pdf"
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

export const publicParameterExampleValue = (
  parameter: TemplateParameter
): FieldValue => {
  if (parameter.type !== "asset" || parameter.exampleValue === "") {
    return parameter.exampleValue
  }
  const asset = studioAssets.find(
    (candidate) => candidate.src === parameter.exampleValue
  )
  return asset?.id ?? parameter.exampleValue
}

function ParameterInput({
  parameter,
  value,
  onChange,
  onValidityChange,
}: {
  parameter: TemplateParameter
  value: FieldValue
  onChange: (value: FieldValue) => void
  onValidityChange: (valid: boolean) => void
}) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={`parameter-${parameter.id}`}>
          {parameter.label}
        </FieldLabel>
        <span className="font-mono text-[9px] text-muted-foreground">
          {parameter.key}
        </span>
      </div>
      <TypedFieldValueControl
        id={`parameter-${parameter.id}`}
        ariaLabel={parameter.label}
        field={parameter}
        value={value}
        assetValueMode="id"
        assetCanBeEmpty={!parameter.required && parameter.bindings.length === 0}
        onCommit={onChange}
        onDraftValidityChange={onValidityChange}
      />
    </Field>
  )
}

export function ApiPlaygroundDialog({
  open,
  onOpenChange,
  version,
  onRequestPublish,
  renderHistory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  version?: TemplateVersion
  onRequestPublish: () => void
  renderHistory: RenderHistoryController
}) {
  const [tab, setTab] = useState("request")
  const [values, setValues] = useState<TemplateModifications>({})
  const [outputs, setOutputs] = useState<Record<string, OutputChoice>>({})
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [invalidParameterIds, setInvalidParameterIds] = useState<Set<string>>(
    new Set()
  )
  const [apiAccess, setApiAccess] = useState<{
    origin: string
    token: string
  } | null>(null)
  const [apiAccessError, setApiAccessError] = useState<string | null>(null)
  const { records, historyError, runRender } = renderHistory

  useEffect(() => {
    if (!version) return
    setInvalidParameterIds(new Set())
    setValues(
      Object.fromEntries(
        version.manifest.parameters.map((parameter) => [
          parameter.key,
          publicParameterExampleValue(parameter),
        ])
      )
    )
    setOutputs(
      Object.fromEntries(
        version.manifest.outputs.map((output, index) => [
          output.id,
          {
            selected: index < 2,
            format:
              index === 0 && output.exportFormats.includes("pdf")
                ? "pdf"
                : "png",
          },
        ])
      )
    )
  }, [version?.id])

  useEffect(() => {
    if (!version || !open) {
      setApiAccess(null)
      setApiAccessError(null)
      return
    }
    const controller = new AbortController()
    void fetch("/v1/studio/session/token", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Demo API access returned ${response.status}.`)
        }
        const payload: unknown = await response.json()
        if (
          !payload ||
          typeof payload !== "object" ||
          !("token" in payload) ||
          typeof payload.token !== "string"
        ) {
          throw new Error("Demo API access returned no token.")
        }
        return payload.token
      })
      .then((token) => {
        setApiAccess({ origin: window.location.origin, token })
        setApiAccessError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setApiAccess(null)
        setApiAccessError(
          error instanceof Error
            ? error.message
            : "Demo API access could not be prepared."
        )
      })
    return () => controller.abort()
  }, [open, version?.id])

  const selections = useMemo<RenderSelection[]>(
    () =>
      Object.entries(outputs).flatMap(([outputId, choice]) =>
        choice.selected ? [{ outputId, format: choice.format }] : []
      ),
    [outputs]
  )
  const requestBody = version
    ? {
        templateId: version.templateId,
        version: version.version,
        modifications: values,
        response: { type: "url", outputs: selections },
      }
    : null
  const requestJson = requestBody ? JSON.stringify(requestBody, null, 2) : ""
  const curl =
    requestBody && apiAccess
      ? `curl --fail-with-body -X POST ${apiAccess.origin}/v1/studio/render \\\n  -H "Authorization: Bearer ${apiAccess.token}" \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(JSON.stringify(requestBody))}`
      : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(760px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-5 pt-5 pr-12">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-secondary">
              <Code2 className="size-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle>API playground</DialogTitle>
              <DialogDescription className="mt-1">
                {version
                  ? `Render immutable ${version.templateId} · version ${version.version}`
                  : "Publish the document before making render requests."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!version ? (
          <div className="flex min-h-0 flex-col items-center justify-center px-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/40">
              <Code2 className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">No published version</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              The playground only accepts immutable versions, so API renders can
              always be reproduced.
            </p>
            <Button className="mt-4" size="sm" onClick={onRequestPublish}>
              Publish current revision
            </Button>
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="min-h-0 gap-0 overflow-hidden"
          >
            <div className="border-b px-5 pt-1">
              <TabsList variant="line">
                <TabsTrigger value="request">Request</TabsTrigger>
                <TabsTrigger value="history">
                  History
                  {records.length ? (
                    <Badge variant="secondary">{records.length}</Badge>
                  ) : null}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="request"
              className="grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <ScrollArea className="min-h-0 border-b md:border-r md:border-b-0">
                <div className="flex flex-col gap-5 p-5">
                  <section>
                    <div className="mb-3">
                      <h3 className="text-xs font-medium">Modifications</h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Stable parameter keys from version {version.version}.
                      </p>
                    </div>
                    <FieldGroup className="gap-3">
                      {version.manifest.parameters.map((parameter) => (
                        <ParameterInput
                          key={parameter.id}
                          parameter={parameter}
                          value={
                            values[parameter.key] ?? parameter.exampleValue
                          }
                          onChange={(value) =>
                            setValues((current) => ({
                              ...current,
                              [parameter.key]: value,
                            }))
                          }
                          onValidityChange={(valid) =>
                            setInvalidParameterIds((current) => {
                              const next = new Set(current)
                              if (valid) next.delete(parameter.id)
                              else next.add(parameter.id)
                              return next
                            })
                          }
                        />
                      ))}
                    </FieldGroup>
                  </section>

                  <section>
                    <div className="mb-3">
                      <h3 className="text-xs font-medium">Outputs</h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        One request can produce several coordinated assets.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {version.manifest.outputs.map((output) => {
                        const choice = outputs[output.id] ?? {
                          selected: false,
                          format: "png" as const,
                        }
                        return (
                          <div
                            key={output.id}
                            className={cn(
                              "grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 rounded-lg border p-3",
                              choice.selected &&
                                "border-foreground/20 bg-muted/30"
                            )}
                          >
                            <FieldLabel className="min-w-0">
                              <Field orientation="horizontal">
                                <Checkbox
                                  checked={choice.selected}
                                  onCheckedChange={(checked) =>
                                    setOutputs((current) => ({
                                      ...current,
                                      [output.id]: {
                                        ...choice,
                                        selected: checked === true,
                                      },
                                    }))
                                  }
                                />
                                <FieldContent className="min-w-0">
                                  <FieldTitle className="truncate text-xs">
                                    {output.name}
                                  </FieldTitle>
                                  <p className="text-[9px] text-muted-foreground">
                                    {output.pages.length} page
                                    {output.pages.length === 1 ? "" : "s"}
                                  </p>
                                </FieldContent>
                              </Field>
                            </FieldLabel>
                            <Select
                              value={choice.format}
                              disabled={!choice.selected}
                              onValueChange={(format: "png" | "pdf") =>
                                setOutputs((current) => ({
                                  ...current,
                                  [output.id]: { ...choice, format },
                                }))
                              }
                            >
                              <SelectTrigger
                                aria-label={`Format for ${output.name}`}
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper">
                                <SelectGroup>
                                  {output.exportFormats.map((format) => (
                                    <SelectItem key={format} value={format}>
                                      {format.toUpperCase()}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </ScrollArea>

              <div className="flex min-h-0 flex-col bg-muted/20">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">Request body</p>
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                      POST /v1/studio/render
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!curl}
                    title={apiAccessError ?? undefined}
                    onClick={() => {
                      void navigator.clipboard.writeText(curl)
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1600)
                    }}
                  >
                    {copied ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Clipboard data-icon="inline-start" />
                    )}
                    {copied ? "Copied" : "Copy cURL"}
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <pre className="p-4 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {requestJson}
                  </pre>
                </ScrollArea>
                <div className="border-t bg-background p-4">
                  {invalidParameterIds.size ? (
                    <p
                      className="mb-2 text-[11px] text-destructive"
                      role="alert"
                    >
                      Fix {invalidParameterIds.size} invalid parameter
                      {invalidParameterIds.size === 1 ? "" : "s"} before
                      rendering.
                    </p>
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={
                      running ||
                      !selections.length ||
                      invalidParameterIds.size > 0
                    }
                    onClick={() => {
                      setRunning(true)
                      void runRender(version, values, selections).then(() => {
                        setRunning(false)
                        setTab("history")
                      })
                    }}
                  >
                    {running ? (
                      <LoaderCircle
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Play data-icon="inline-start" />
                    )}
                    {running
                      ? "Rendering…"
                      : `Run ${selections.length || ""} output${selections.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                {records.length ? (
                  <div className="flex flex-col gap-3 p-5">
                    {records.map((record) => (
                      <article key={record.id} className="rounded-lg border">
                        <div className="flex items-start gap-3 p-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                            {record.status === "rendering" ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <History className="size-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-[10px] font-medium">
                                {record.id}
                              </p>
                              <Badge
                                variant={
                                  record.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {record.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {record.templateId} · v{record.version} ·{" "}
                              {record.selections.length} requested output
                              {record.selections.length === 1 ? "" : "s"}
                            </p>
                            {record.error ? (
                              <div className="mt-2 flex items-start justify-between gap-3">
                                <p className="text-[11px] leading-relaxed text-destructive">
                                  {record.error}
                                </p>
                                {record.templateId === version.templateId &&
                                record.version === version.version ? (
                                  <Button
                                    className="shrink-0"
                                    size="sm"
                                    variant="outline"
                                    disabled={running}
                                    onClick={() => {
                                      setRunning(true)
                                      void runRender(
                                        version,
                                        record.modifications,
                                        record.selections
                                      ).then(() => setRunning(false))
                                    }}
                                  >
                                    <RotateCw data-icon="inline-start" />
                                    Retry
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {record.artifacts.length ? (
                          <div className="grid gap-2 border-t bg-muted/20 p-3 sm:grid-cols-2">
                            {record.artifacts.map((artifact) => (
                              <a
                                key={artifact.id}
                                href={artifact.objectUrl}
                                download={artifact.filename}
                                className="flex min-w-0 items-center gap-2 rounded-lg border bg-background p-2.5 transition-colors hover:bg-muted/40"
                              >
                                <Download className="size-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                                  {artifact.filename}
                                </span>
                                <span className="shrink-0 text-[9px] text-muted-foreground">
                                  {formatBytes(artifact.bytes)}
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
                    <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/40">
                      <History className="size-4 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm font-medium">
                      No render requests
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      {historyError
                        ? "Saved render history is temporarily unavailable. New requests will still appear here."
                        : "Run the published template to create downloadable outputs."}
                    </p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
