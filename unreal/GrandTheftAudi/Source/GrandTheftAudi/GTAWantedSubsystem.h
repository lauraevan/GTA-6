#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "GTAWantedSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnWantedChanged, int32, Stars, int32, PrevStars);

/**
 * 1–5★ wanted/heat system — direct port of client/src/ai/wantedSystem.js.
 * Crimes add heat when witnessed; heat decays out of police line-of-sight.
 */
UCLASS()
class GRANDTHEFTAUDI_API UGTAWantedSubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintAssignable, Category = "Wanted")
	FOnWantedChanged OnWantedChanged;

	UFUNCTION(BlueprintCallable, Category = "Wanted")
	void AddCrime(float Severity, const FVector& WorldPos, bool bWitnessed);

	UFUNCTION(BlueprintCallable, Category = "Wanted")
	void ReportSeen(const FVector& CopPos);

	UFUNCTION(BlueprintCallable, Category = "Wanted")
	void SetStars(int32 NewStars);

	UFUNCTION(BlueprintCallable, Category = "Wanted")
	void ClearWanted();

	UFUNCTION(BlueprintPure, Category = "Wanted")
	int32 GetStars() const { return Stars; }

	UFUNCTION(BlueprintPure, Category = "Wanted")
	float GetHeat() const { return Heat; }

	UFUNCTION(BlueprintPure, Category = "Wanted")
	FVector GetLastSeenPos() const { return LastSeenPos; }

	// FTickableGameObject
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UGTAWantedSubsystem, STATGROUP_Tickables); }
	virtual bool IsTickableInEditor() const override { return false; }

private:
	static constexpr float Thresholds[5] = { 15.f, 70.f, 160.f, 320.f, 520.f };

	float Heat = 0.f;
	int32 Stars = 0;
	float TimeNow = 0.f;
	float LastSeenTime = -1000.f;
	FVector LastSeenPos = FVector::ZeroVector;

	int32 TargetStars() const;
	void RecomputeStars();
};
