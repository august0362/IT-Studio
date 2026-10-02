import {
  ErrorCode,
  type CommandKind as CommandKindType,
  type ErrorCode as ErrorCodeType,
  type ProviderId,
} from '@itstudio/schemas';

export interface RemediationContext {
  readonly files?: readonly string[];
  readonly commandKind?: CommandKindType;
  readonly firstDiagnostic?: string;
  readonly journalPath?: string;
  readonly provider?: ProviderId;
  readonly modelsTried?: readonly string[];
  readonly budget?: { readonly spent: string; readonly limit: string };
}

type RemediationSteps = (context?: RemediationContext) => readonly string[];

const remediation: Record<ErrorCodeType, RemediationSteps> = {
  [ErrorCode.VALIDATION]: () => ['Review the highlighted values and correct the invalid input.'],
  [ErrorCode.NOT_FOUND]: () => ['Confirm the item still exists, then select it again.'],
  [ErrorCode.CONFLICT]: () => ['Refresh the item and retry your change.'],
  [ErrorCode.SECRET_MISSING]: () => ['Add the required provider key in Settings, then retry.'],
  [ErrorCode.PROVIDER_RATE_LIMITED]: () => ['Wait for the provider limit to reset, or choose another model.'],
  [ErrorCode.PROVIDER_QUOTA_EXHAUSTED]: () => ['Check the provider billing page and renew the available quota.'],
  [ErrorCode.PROVIDER_AUTH]: (context) => [
    `Verify the ${context?.provider ?? 'selected provider'} API key in Settings, then retry.`,
  ],
  [ErrorCode.PROVIDER_SERVER]: () => ['Wait briefly and retry, or choose another model.'],
  [ErrorCode.PROVIDER_TIMEOUT]: () => ['Retry with a shorter prompt or choose a faster model.'],
  [ErrorCode.PROVIDER_BAD_REQUEST]: () => ['Choose a supported model or adjust the request settings.'],
  [ErrorCode.PROVIDER_CONTENT_FILTERED]: () => ['Revise the prompt to comply with provider policies, then retry.'],
  [ErrorCode.LADDER_EXHAUSTED]: (context) => [
    context?.modelsTried?.length
      ? `Choose an available model; these models were tried: ${context.modelsTried.join(', ')}.`
      : 'Choose another enabled model and retry.',
  ],
  [ErrorCode.FALLBACK_DECLINED]: () => ['Select a fallback model or cancel the request.'],
  [ErrorCode.BUDGET_HARD_STOP]: (context) => [
    context?.budget
      ? `Review the budget: ${context.budget.spent} spent of ${context.budget.limit}.`
      : 'Review the project budget and increase its limit or wait for the next budget period.',
    'Change the Hard Stop setting in Settings if you want paid calls to continue past the limit.',
  ],
  [ErrorCode.PATH_OUTSIDE_WORKSPACE]: () => ['Choose a file inside the active project workspace and retry.'],
  [ErrorCode.PATCH_CONFLICT]: (context) => [
    context?.files?.length
      ? `Review your edits to ${context.files.join(', ')} in VS Code and save or discard them.`
      : 'Review the changed files in VS Code and save or discard your edits.',
    'Re-run the pipeline after resolving the file changes.',
  ],
  [ErrorCode.COMMAND_FAILED]: (context) => [
    context?.commandKind
      ? `Review the ${context.commandKind} command output${context.firstDiagnostic ? `: ${context.firstDiagnostic}` : ''}.`
      : `Review the command output${context?.firstDiagnostic ? `: ${context.firstDiagnostic}` : ''}.`,
    'Fix the reported issue and run the validation command again.',
  ],
  [ErrorCode.ROLLBACK_FAILED]: (context) => [
    context?.journalPath
      ? `Restore the workspace manually using the transaction journal at ${context.journalPath}.`
      : 'Locate the transaction journal in the project .itstudio/tx folder and restore the workspace manually.',
    'Keep the journal until you verify that all affected files are restored.',
  ],
  [ErrorCode.PIPELINE_REVIEW_REJECTED]: () => [
    'Review the findings, update the implementation, and run the pipeline again.',
  ],
  [ErrorCode.VSCODE_UNAVAILABLE]: () => ['Install or open VS Code to view project changes, then retry.'],
  [ErrorCode.CANCELLED]: () => ['Start the operation again when you are ready.'],
  [ErrorCode.INTERNAL]: () => ['Retry the operation; contact support if the problem continues.'],
};

export function remediationFor(code: ErrorCodeType, context?: RemediationContext): readonly string[] {
  return remediation[code](context);
}
