"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NodeScriptPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.id as string;
  const t = useTranslations("nodeScript");
  const tc = useTranslations("common");
  const te = useTranslations("errors");

  const [oneliner, setOneliner] = useState("");
  const [script, setScript] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch node detail to get agentToken
    fetch(`/api/nodes/${nodeId}`)
      .then((res) => res.json())
      .then((res) => {
        const token = res.data?.agentToken;
        const origin = window.location.origin;
        setOneliner(
          `curl -fsSL '${origin}/api/nodes/${nodeId}/script?token=${token}' | bash`
        );
      })
      .catch(() => toast.error(t("loadNodeFailed")));

    // Load full script for preview
    fetch(`/api/nodes/${nodeId}/script`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(translateError(json.error, te, t("loadScriptFailed")));
        }
        return res.text();
      })
      .then((text) => setScript(text))
      .catch((err) => toast.error(err.message ?? t("loadScriptFailed")))
      .finally(() => setLoading(false));
  }, [nodeId]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(oneliner)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
  };

  return (
    <div className="space-y-6 w-full max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button variant="outline" onClick={() => router.push(`/nodes/${nodeId}`)}>
          {tc("back")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("oneClickInstall")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("instruction")}
          </p>
          <div className="flex gap-2">
            <pre className="flex-1 code-block p-3 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap break-all">
              {oneliner || tc("loading")}
            </pre>
            <Button onClick={handleCopy} disabled={!oneliner}>
              {t("copy")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h3 className="font-medium mb-2">{t("usageTitle")}</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>{t("usage1")}</li>
            <li>{t("usage2")}</li>
            <li>{t("usage3")}</li>
            <li>{t("usage4")}</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("fullScript")}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFull(!showFull)}
            >
              {showFull ? t("collapse") : t("expand")}
            </Button>
          </div>
        </CardHeader>
        {showFull && (
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground">
                {tc("loading")}
              </div>
            ) : (
              <pre className="code-block p-4 rounded-lg text-xs w-full overflow-x-auto max-h-[500px] whitespace-pre-wrap break-all">
                {script}
              </pre>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
