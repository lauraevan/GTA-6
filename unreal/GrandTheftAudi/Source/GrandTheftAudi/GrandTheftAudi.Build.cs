using UnrealBuildTool;

public class GrandTheftAudi : ModuleRules
{
	public GrandTheftAudi(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"Json",
			"JsonUtilities",
			"ChaosVehicles"
		});
	}
}
