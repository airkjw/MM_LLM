import { BookOpen, Check, Copy, FileText, HeartPulse, ShieldCheck, Sparkles } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DroppedAttachment } from "../../shared/contracts";
import { assertDroppedFileBatch } from "../../shared/drop-limits";
import { markdownImagePresentation } from "../../shared/markdown-security";

export const templates = [
  { icon: HeartPulse, title: "병원 경영", detail: "운영 지표와 개선 과제", prompt: "분석할 병원의 현황이나 운영 지표를 적어 주세요.", instruction: "병원 운영 자료를 재무·환자경험·프로세스·인력 관점에서 분석하세요. 개선 과제는 영향도와 실행 가능성을 기준으로 우선순위를 제시하고, 필요한 지표가 없으면 먼저 질문하세요." },
  { icon: BookOpen, title: "의료 정책", detail: "제도 변화와 영향", prompt: "검토할 의료 정책이나 제도 변화를 적어 주세요.", instruction: "의료 정책을 환자·의료기관·보건의료인·정부 등 이해관계자별로 분석하세요. 최신 1차 근거를 우선하고 시행 시점, 적용 범위, 불확실성을 구분하세요." },
  { icon: FileText, title: "논문 읽기", detail: "핵심 주장과 한계", prompt: "논문을 첨부하고 특히 확인할 질문을 적어 주세요.", instruction: "논문의 연구 질문, 설계, 표본, 변수, 분석 방법, 주요 결과, 의료경영 시사점과 한계를 구분해 요약하세요. 원문에 없는 결론은 추정이라고 표시하고, 가능한 경우 표와 근거 위치를 제시하세요." },
  { icon: Sparkles, title: "연구 설계", detail: "질문에서 방법까지", prompt: "발전시키고 싶은 의료경영 연구 주제를 적어 주세요.", instruction: "연구 주제를 석사 논문 수준의 연구 질문, 이론적 근거, 가설, 조작적 변수, 자료 수집, 분석 계획으로 발전시키세요. 윤리·편향·실행 가능성과 연구의 한계를 함께 검토하세요." }
];

export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export async function readDroppedFiles(files: File[]): Promise<DroppedAttachment[]> {
  assertDroppedFileBatch(files);
  const output: DroppedAttachment[] = [];
  // Read sequentially so a valid 64MB batch cannot transiently double memory through Promise fan-out.
  for (const file of files) output.push({ name: file.name, bytes: await file.arrayBuffer() });
  return output;
}

export function DeidCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="deid-check">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="custom-check">{checked && <Check size={12} />}</span>
    <span>환자 식별정보를 제거한 자료만 전송합니다</span>
    <ShieldCheck size={15} />
  </label>;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

export function MarkdownText({ text }: { text: string }) {
  return <div className="markdown-text"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => {
      const safe = typeof href === "string" && href.startsWith("https://") &&
        !/^https:\/\/factchat-cloud\.mindlogic\.ai\/v1\/public\/f\//i.test(href);
      return safe ? <a href={href} onClick={(event) => {
        event.preventDefault(); void window.mmllm.openExternal(href);
      }}>{children}</a> : <span title="보안상 직접 열 수 없는 링크입니다.">{children}
        <span className="sr-only"> (보안상 직접 열 수 없는 링크)</span></span>;
    },
    pre: ({ children }) => <div className="code-block"><button type="button" title="코드 복사"
      onClick={() => void navigator.clipboard.writeText(nodeText(children))}><Copy size={14} /> 복사</button>
      <pre>{children}</pre></div>,
    table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>
    ,img: ({ src, alt }) => {
      const image = markdownImagePresentation(src, alt);
      return image.externalUrl
        ? <a href={image.externalUrl} onClick={(event) => { event.preventDefault();
          void window.mmllm.openExternal(image.externalUrl!); }}>[{image.label} 링크]</a>
        : <span>[{image.label}]</span>;
    }
  }}>{text}</ReactMarkdown></div>;
}
