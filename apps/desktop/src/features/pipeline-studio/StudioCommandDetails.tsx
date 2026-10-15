import type { CommandRun } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandOutput } from '../code/CommandOutput';
import type { CommandOutputState } from '../code/pipeline-store';

export function StudioCommandDetails({
  command,
  output,
}: {
  readonly command: CommandRun;
  readonly output: CommandOutputState | undefined;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3>
        {command.spec.kind} · {command.spec.executable} {command.spec.args.join(' ')}
      </h3>
      <p>
        {t('pipelineStudio.commandResult', {
          exit: command.exitCode ?? '—',
          duration: command.durationMs,
          limit: command.spec.timeoutMs,
        })}
      </p>
      {command.timedOut ? <span className="studio-timeout-chip">{t('pipelineStudio.timedOut')}</span> : null}
      <CommandOutput
        commandId={command.id}
        output={output ?? { stdout: command.stdoutTail, stderr: command.stderrTail, truncated: false }}
      />
      {command.diagnostics.length > 0 ? (
        <div>
          <h4>{t('pipelineStudio.diagnostics')}</h4>
          <ul className="list-disc pl-5" aria-label={t('pipelineStudio.diagnostics')}>
            {command.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {diagnostic.path}:{diagnostic.line}:{diagnostic.column} — {diagnostic.message}
                <span className="block text-sm">
                  {t(`pipelineStudio.diagnosticSeverity.${diagnostic.severity}`)} · {diagnostic.source}
                  {diagnostic.code === undefined ? null : ` · ${diagnostic.code}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {command.tests === undefined ? null : (
        <div>
          <h4>{t('pipelineStudio.testResults')}</h4>
          <p>{t('pipelineStudio.testSummary', { ...command.tests })}</p>
          {command.tests.failures.length > 0 ? (
            <ul className="list-disc pl-5" aria-label={t('pipelineStudio.testFailures')}>
              {command.tests.failures.map((failure, index) => (
                <li key={index}>
                  {failure.path === undefined ? null : `${failure.path} — `}
                  {failure.name} — {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
