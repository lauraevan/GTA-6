using UnrealBuildTool;
using System.Collections.Generic;

public class GrandTheftAudiEditorTarget : TargetRules
{
	public GrandTheftAudiEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("GrandTheftAudi");
	}
}
