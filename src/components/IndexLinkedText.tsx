import { Link } from "react-router-dom";
import { splitIndexLinkedText } from "../features/world-index/links";

type Props = {
  text: string;
};

export function IndexLinkedText({ text }: Props) {
  return splitIndexLinkedText(text).map((part, index) => {
    if (part.kind === "text") return <span key={`${index}-${part.value}`}>{part.value}</span>;
    const query = part.entryId
      ? `entry=${encodeURIComponent(part.entryId)}`
      : `search=${encodeURIComponent(part.label)}`;
    return (
      <Link
        key={`${index}-${part.label}`}
        className="font-medium text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200"
        to={`../index?${query}`}
        title={part.entryId ? "Open this index entry" : "Find or create this index entry"}
      >
        {part.label}
      </Link>
    );
  });
}
