import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  listWorldTemplates,
  type TemplateType,
  type WorldTemplate,
} from "../../api/templates";

type ParsedTemplate = WorldTemplate & { definition: any };

const TEMPLATE_HEADINGS: Record<TemplateType, string> = {
  character: "Character",
  item: "Item",
  ability: "Ability",
  custom_entity: "Custom entities",
};

export function WorldIndexPage() {
  const { worldId } = useParams();
  const [templates, setTemplates] = useState<ParsedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    listWorldTemplates(worldId)
      .then((data) => {
        setTemplates(
          data.map((template) => {
            let definition: any = {};
            try {
              definition = JSON.parse(template.definition_json);
            } catch {
              definition = {};
            }
            return { ...template, definition };
          })
        );
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  const grouped = useMemo(() => {
    const base: Record<TemplateType, ParsedTemplate[]> = {
      character: [],
      item: [],
      ability: [],
      custom_entity: [],
    };
    templates.forEach((template) => {
      base[template.template_type].push(template);
    });
    return base;
  }, [templates]);

  if (!worldId) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h2 className="text-lg font-bold mb-2">Template Index</h2>
        <p className="text-slate-300 text-sm">
          View the character, item, ability, and custom entity templates locked in during
          world creation.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {loading && (
        <p className="text-sm text-slate-400">Loading template definitions…</p>
      )}

      {(Object.keys(grouped) as TemplateType[]).map((type) => (
        <section key={type} className="space-y-3 border border-slate-800 rounded-lg p-4">
          <header>
            <h3 className="text-sm font-semibold text-slate-200">
              {TEMPLATE_HEADINGS[type]}
            </h3>
            <p className="text-xs text-slate-500">
              {type === "custom_entity"
                ? "Custom taxonomy entries and flavor text."
                : "Sheet sections defined when the world was created."}
            </p>
          </header>
          {grouped[type].length === 0 ? (
            <p className="text-xs text-slate-500">No templates persisted yet.</p>
          ) : (
            grouped[type].map((template) => (
              <div
                key={template.id}
                className="rounded border border-slate-800 bg-slate-950/40 p-4 space-y-3"
              >
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-semibold text-slate-100">{template.name}</p>
                    <p className="text-xs text-slate-500">
                      Created{" "}
                      {new Date(template.created_at * 1000).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {type === "character" && (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {template.definition.features?.map((feature: any) => (
                      <li key={feature.id} className="flex justify-between">
                        <span>{feature.label}</span>
                        <span className="text-slate-500">{feature.type}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {type !== "character" && type !== "custom_entity" && (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {template.definition.fields?.map((field: any) => (
                      <li key={field.id} className="flex justify-between">
                        <span>{field.label}</span>
                        <span className="text-slate-500">{field.inputType}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {type === "custom_entity" && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide">
                        Fields
                      </p>
                      <ul className="text-xs text-slate-300 space-y-1">
                        {template.definition.fields?.map((field: any) => (
                          <li key={field.id}>{field.label}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide">
                        Values
                      </p>
                      <ul className="text-xs text-slate-300 space-y-1">
                        {template.definition.values?.map((value: any) => (
                          <li key={value.id}>
                            <span className="font-semibold">{value.value}:</span>{" "}
                            <span className="text-slate-400">{value.flavorText}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
