import { useCallback, useState } from "react";
import { type CampaignBootstrap } from "@/lib/campaign-bootstrap";

export type DebugBootstrapState = {
  hiddenView: CampaignBootstrap;
  updatedAt?: string;
} | null;

export function useBootstrapDebugTools(params: {
  campaignId: string;
  onPublicBootstrapUpdate: (publicView: unknown) => void;
  onError: (message: string) => void;
}) {
  const { campaignId, onPublicBootstrapUpdate, onError } = params;
  const [debugBootstrapState, setDebugBootstrapState] = useState<DebugBootstrapState>(null);
  const [isLoadingDebugBootstrapState, setIsLoadingDebugBootstrapState] = useState(false);
  const [isApplyingDebugBootstrapAction, setIsApplyingDebugBootstrapAction] = useState(false);

  const loadDebugBootstrapState = useCallback(async () => {
    if (!campaignId) {
      return;
    }
    setIsLoadingDebugBootstrapState(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/bootstrap/debug`, {
        headers: {
          "X-Debug-State-Logging": "true",
        },
      });
      const data = await response.json();
      if (!response.ok || !data.bootstrap?.hiddenView) {
        throw new Error(data.error ?? "Unable to load debug bootstrap state.");
      }
      setDebugBootstrapState({
        hiddenView: data.bootstrap.hiddenView as CampaignBootstrap,
        updatedAt:
          typeof data.bootstrap.updatedAt === "string" ? data.bootstrap.updatedAt : undefined,
      });
    } catch (debugBootstrapError) {
      onError(
        debugBootstrapError instanceof Error
          ? debugBootstrapError.message
          : "Unable to load debug bootstrap state.",
      );
    } finally {
      setIsLoadingDebugBootstrapState(false);
    }
  }, [campaignId, onError]);

  const applyDebugBootstrapAction = useCallback(async (
    payload: Record<string, unknown>,
    fallbackMessage: string,
  ) => {
    if (!campaignId || isApplyingDebugBootstrapAction) {
      return;
    }
    onError("");
    setIsApplyingDebugBootstrapAction(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/bootstrap/debug`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-State-Logging": "true",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.bootstrap?.hiddenView || !data.bootstrap?.publicView) {
        throw new Error(data.error ?? fallbackMessage);
      }

      setDebugBootstrapState({
        hiddenView: data.bootstrap.hiddenView as CampaignBootstrap,
        updatedAt:
          typeof data.bootstrap.updatedAt === "string" ? data.bootstrap.updatedAt : undefined,
      });
      onPublicBootstrapUpdate(data.bootstrap.publicView);
    } catch (debugBootstrapError) {
      onError(
        debugBootstrapError instanceof Error ? debugBootstrapError.message : fallbackMessage,
      );
    } finally {
      setIsApplyingDebugBootstrapAction(false);
    }
  }, [campaignId, isApplyingDebugBootstrapAction, onError, onPublicBootstrapUpdate]);

  return {
    debugBootstrapState,
    isLoadingDebugBootstrapState,
    isApplyingDebugBootstrapAction,
    loadDebugBootstrapState,
    applyDebugBootstrapAction,
  };
}

