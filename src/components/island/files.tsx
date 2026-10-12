import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { Empty } from "./ui";
import { artifactOpenState, artifactRows, bytesLabel, groupArtifacts, VERDICT_LABEL, type ArtifactRow } from "./files-model";

/**
 * Files: the artifacts the Host produced across Missions and Projects, grouped by its own verdict. Only a verified artifact
 * can be opened, and the Host re-checks its content hash on every open (project.artifact). Nothing is labelled verified here
 * unless the Host verified it.
 */
export function Files() {
  const store = useIsland();
  const online = store.canAct();
  const projectNames = new Map(store.projects.map((project) => [project.id, project.name]));
  const rows = artifactRows(store.missions?.missions ?? [], projectNames);
  const groups = groupArtifacts(rows);
  const [preview, setPreview] = useState<{ title: string; body: string; sha256: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Focus: the preview takes focus when it opens and returns to the file's Open button when it closes.
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const openButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (preview) {
      previewHeading.current?.focus();
      return;
    }
    if (lastOpened.current) openButtons.current.get(lastOpened.current)?.focus();
    lastOpened.current = null;
  }, [preview]);

  const open = async (row: ArtifactRow) => {
    if (!row.projectId || busy) return;
    lastOpened.current = row.id;
    setBusy(row.id);
    try {
      const result = (await store.projectCommand("project.artifact", { projectId: row.projectId, artifactId: row.id })) as {
        artifact: { title: string; sha256: string; location: { kind: string; mediaType: string } };
        body: string;
        encoding: string;
      } | null;
      if (result && result.encoding !== "base64") setPreview({ title: result.artifact.title, body: result.body, sha256: result.artifact.sha256 });
      else if (result) setPreview({ title: result.artifact.title, body: "This file is not previewable here. Open it from its Project.", sha256: result.artifact.sha256 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Files</p>
          <h1>Files from your Missions</h1>
          <p>Results your Host produced, grouped by what Bunny-A verified. Verified files open here.</p>
        </div>
      </div>
      {!rows.length &&
        (store.missions ? (
          <Empty
            title="No files yet."
            detail="When a Mission or Task produces a file, it appears here with its verification status."
          />
        ) : (
          <Empty title="Files are loading." detail="The Host has not sent its Missions yet, so there is nothing to list." />
        ))}
      {(["verified", "unverified", "failed"] as const).map((verdict) => {
        const list = groups[verdict];
        if (!list.length) return null;
        return (
          <section className="t8-section" key={verdict} aria-labelledby={`files-${verdict}`}>
            <h2 id={`files-${verdict}`}>
              {verdict === "verified" ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />} {VERDICT_LABEL[verdict]}
            </h2>
            <div className="t8-surface">
              {list.map((row) => {
                const state = artifactOpenState(row, online);
                return (
                  <div className="fi-row" key={row.id}>
                    <span>
                      <strong>
                        <FileText size={14} /> {row.title}
                      </strong>
                      <small className="cx-muted">
                        {" "}
                        {row.projectName ? `${row.projectName} · ` : ""}
                        {row.missionTitle} · {row.type.replaceAll("_", " ")} · {bytesLabel(row.bytes)}
                      </small>
                      {!state.enabled && state.reason && <small className="cx-muted"> {state.reason}</small>}
                    </span>
                    <span className="fi-actions">
                      <button
                        ref={(element) => {
                          if (element) openButtons.current.set(row.id, element);
                        }}
                        className="btn secondary"
                        type="button"
                        disabled={!state.enabled || busy === row.id}
                        onClick={() => void open(row)}
                      >
                        {busy === row.id ? "Checking…" : "Open"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {preview && (
        <section className="t8-surface" style={{ padding: 16, marginTop: 12 }} aria-label="Preview">
          <h3 ref={previewHeading} tabIndex={-1}>
            {preview.title}
          </h3>
          <small className="cx-muted">Content checked against SHA-256 {preview.sha256}</small>
          <pre className="fi-preview" tabIndex={0} aria-label={`Contents of ${preview.title}`}>
            {preview.body}
          </pre>
          <button className="btn secondary" type="button" onClick={() => setPreview(null)}>
            Close preview
          </button>
        </section>
      )}
    </>
  );
}
