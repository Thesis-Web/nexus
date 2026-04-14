import { loadPolicyFile, loadControlPlaneKey } from '@nexus/core';
export async function cmdPolicyValidate(filepath: string): Promise<void> {
  const kp = await loadControlPlaneKey();
  const policy = await loadPolicyFile(filepath, kp);
  console.log(
    JSON.stringify(
      {
        ok: true,
        data: {
          bundleId: policy.bundleId,
          bundleVersion: policy.bundleVersion,
          ruleCount: policy.rules.length,
        },
      },
      null,
      2
    )
  );
}
export async function cmdPolicyTest(filepath: string, _actionJson: string): Promise<void> {
  const kp = await loadControlPlaneKey();
  await loadPolicyFile(filepath, kp);
  console.log(
    JSON.stringify({ ok: true, data: { message: 'Policy loaded and signature verified' } }, null, 2)
  );
}
