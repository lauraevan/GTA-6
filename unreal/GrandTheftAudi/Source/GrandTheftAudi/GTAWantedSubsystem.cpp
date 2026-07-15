#include "GTAWantedSubsystem.h"

void UGTAWantedSubsystem::AddCrime(float Severity, const FVector& WorldPos, bool bWitnessed)
{
	if (!bWitnessed || Severity <= 0.f)
	{
		return;
	}
	const bool bCopSees = (TimeNow - LastSeenTime) < 0.5f;
	Heat = FMath::Min(700.f, Heat + Severity * (bCopSees ? 1.5f : 1.f));
	LastSeenPos = WorldPos;
	RecomputeStars();
}

void UGTAWantedSubsystem::ReportSeen(const FVector& CopPos)
{
	LastSeenTime = TimeNow;
	LastSeenPos = CopPos;
}

void UGTAWantedSubsystem::SetStars(int32 NewStars)
{
	Heat = NewStars <= 0 ? 0.f : Thresholds[FMath::Clamp(NewStars, 1, 5) - 1] + 12.f;
	RecomputeStars();
}

void UGTAWantedSubsystem::ClearWanted()
{
	Heat = 0.f;
	RecomputeStars();
}

int32 UGTAWantedSubsystem::TargetStars() const
{
	int32 S = 0;
	for (int32 I = 0; I < 5; ++I)
	{
		if (Heat >= Thresholds[I])
		{
			S = I + 1;
		}
	}
	return S;
}

void UGTAWantedSubsystem::RecomputeStars()
{
	const int32 Target = TargetStars();
	const int32 Prev = Stars;
	const float UnseenFor = TimeNow - LastSeenTime;
	if (Target > Stars)
	{
		Stars = Target;
	}
	else if (Target < Stars && UnseenFor > 8.f)
	{
		Stars = Target;
	}
	if (Stars != Prev)
	{
		OnWantedChanged.Broadcast(Stars, Prev);
	}
}

void UGTAWantedSubsystem::Tick(float DeltaTime)
{
	TimeNow += DeltaTime;
	if (Heat > 0.f)
	{
		const bool bSeenRecently = (TimeNow - LastSeenTime) < 0.5f;
		const float Grace = 9.f + Stars * 4.f;
		const float Rate = bSeenRecently ? 0.4f : ((TimeNow - LastSeenTime) > Grace ? 3.5f + Stars : 0.8f);
		Heat = FMath::Max(0.f, Heat - Rate * DeltaTime);
		RecomputeStars();
	}
}
