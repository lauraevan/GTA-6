#include "GTACityImporter.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

AGTACityImporter::AGTACityImporter()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

UInstancedStaticMeshComponent* AGTACityImporter::MakeISM(const FString& Name, UMaterialInterface* Material)
{
	UInstancedStaticMeshComponent* ISM = NewObject<UInstancedStaticMeshComponent>(this, *Name);
	ISM->SetStaticMesh(BoxMesh);
	if (Material)
	{
		ISM->SetMaterial(0, Material);
	}
	ISM->SetupAttachment(RootComponent);
	ISM->RegisterComponent();
	SpawnedComponents.Add(ISM);
	return ISM;
}

void AGTACityImporter::ClearCity()
{
	for (UInstancedStaticMeshComponent* Comp : SpawnedComponents)
	{
		if (IsValid(Comp))
		{
			Comp->DestroyComponent();
		}
	}
	SpawnedComponents.Empty();
}

void AGTACityImporter::BuildCity()
{
	if (!BoxMesh)
	{
		UE_LOG(LogTemp, Error, TEXT("[GTA] Assign BoxMesh (any unit cube) first."));
		return;
	}
	const FString Path = FPaths::ProjectContentDir() / TEXT("City") / CityJsonFilename;
	FString Raw;
	if (!FFileHelper::LoadFileToString(Raw, *Path))
	{
		UE_LOG(LogTemp, Error, TEXT("[GTA] Could not read %s — copy client/public/world/city.json there."), *Path);
		return;
	}
	TSharedPtr<FJsonObject> City;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Raw);
	if (!FJsonSerializer::Deserialize(Reader, City) || !City.IsValid())
	{
		UE_LOG(LogTemp, Error, TEXT("[GTA] city.json failed to parse"));
		return;
	}

	ClearCity();

	// ---- buildings: one ISM per style archetype, tiers become stacked instances
	TMap<int32, UInstancedStaticMeshComponent*> StyleISMs;
	int32 BuildingCount = 0;

	const TArray<TSharedPtr<FJsonValue>>* Chunks = nullptr;
	if (City->TryGetArrayField(TEXT("chunks"), Chunks))
	{
		for (const TSharedPtr<FJsonValue>& ChunkVal : *Chunks)
		{
			const TSharedPtr<FJsonObject> Chunk = ChunkVal->AsObject();
			const TArray<TSharedPtr<FJsonValue>>* Buildings = nullptr;
			if (!Chunk.IsValid() || !Chunk->TryGetArrayField(TEXT("b"), Buildings))
			{
				continue;
			}
			for (const TSharedPtr<FJsonValue>& BVal : *Buildings)
			{
				const TArray<TSharedPtr<FJsonValue>>& B = BVal->AsArray();
				if (B.Num() < 8)
				{
					continue;
				}
				const double X = B[0]->AsNumber();
				const double Z = B[1]->AsNumber();
				const double W = B[2]->AsNumber();
				const double D = B[3]->AsNumber();
				const double H = B[4]->AsNumber();
				const double RotQuarter = B[5]->AsNumber();
				const int32 Style = static_cast<int32>(B[6]->AsNumber());

				UInstancedStaticMeshComponent*& ISM = StyleISMs.FindOrAdd(Style);
				if (!ISM)
				{
					UMaterialInterface* Mat = StyleMaterials.IsValidIndex(Style) ? StyleMaterials[Style].Get() : nullptr;
					ISM = MakeISM(FString::Printf(TEXT("Buildings_Style%d"), Style), Mat);
				}

				const FRotator Rot(0.f, static_cast<float>(RotQuarter) * 90.f, 0.f);

				// optional setback tiers: [[wScale, dScale, hFrac], ...]
				if (B.Num() > 8 && B[8]->Type == EJson::Array)
				{
					double YOff = 0.0;
					for (const TSharedPtr<FJsonValue>& TierVal : B[8]->AsArray())
					{
						const TArray<TSharedPtr<FJsonValue>>& T = TierVal->AsArray();
						const double TW = W * T[0]->AsNumber();
						const double TD = D * T[1]->AsNumber();
						const double TH = H * T[2]->AsNumber();
						FTransform Xf(Rot, GameToUE(X, YOff + TH * 0.5, Z), FVector(TW, TD, TH));
						ISM->AddInstance(Xf);
						YOff += TH;
					}
				}
				else
				{
					FTransform Xf(Rot, GameToUE(X, H * 0.5, Z), FVector(W, D, H));
					ISM->AddInstance(Xf);
				}
				BuildingCount++;
			}
		}
	}

	// ---- roads: flattened boxes along the merged runs
	int32 RoadCount = 0;
	const TSharedPtr<FJsonObject>* Meta = nullptr;
	double Half = 960.0, BlockSize = 60.0;
	if (City->TryGetObjectField(TEXT("meta"), Meta))
	{
		Half = (*Meta)->GetNumberField(TEXT("worldSize")) * 0.5;
		BlockSize = (*Meta)->GetNumberField(TEXT("blockSize"));
	}
	auto LinePos = [Half, BlockSize](double I) { return -Half + I * BlockSize; };

	const TArray<TSharedPtr<FJsonValue>>* Roads = nullptr;
	if (City->TryGetArrayField(TEXT("roads"), Roads))
	{
		UInstancedStaticMeshComponent* RoadISM = MakeISM(TEXT("Roads"), RoadMaterial);
		const TSharedPtr<FJsonObject> RoadHalf = (*Meta)->GetObjectField(TEXT("roadHalf"));
		for (const TSharedPtr<FJsonValue>& RVal : *Roads)
		{
			const TSharedPtr<FJsonObject> R = RVal->AsObject();
			const double HalfW = RoadHalf->GetNumberField(FString::FromInt(static_cast<int32>(R->GetNumberField(TEXT("t")))));
			const double C = LinePos(R->GetNumberField(TEXT("i")));
			const double A0 = LinePos(R->GetNumberField(TEXT("j0")));
			const double A1 = LinePos(R->GetNumberField(TEXT("j1")));
			const double Len = A1 - A0;
			const double Mid = (A0 + A1) * 0.5;
			const bool bVertical = R->GetStringField(TEXT("a")) == TEXT("v");
			const FVector Center = bVertical ? GameToUE(C, 0.05, Mid) : GameToUE(Mid, 0.05, C);
			const FVector Scale = bVertical
				? FVector(HalfW * 2.0, Len + HalfW * 2.0, 0.1)
				: FVector(Len + HalfW * 2.0, HalfW * 2.0, 0.1);
			RoadISM->AddInstance(FTransform(FRotator::ZeroRotator, Center, Scale));
			RoadCount++;
		}
	}

	// ---- water cells (district code 0)
	const TArray<TSharedPtr<FJsonValue>>* DistrictRows = nullptr;
	if (City->TryGetArrayField(TEXT("districts"), DistrictRows))
	{
		UInstancedStaticMeshComponent* WaterISM = MakeISM(TEXT("Water"), WaterMaterial);
		for (int32 BZ = 0; BZ < DistrictRows->Num(); ++BZ)
		{
			const TArray<TSharedPtr<FJsonValue>>& Row = (*DistrictRows)[BZ]->AsArray();
			for (int32 BX = 0; BX < Row.Num(); ++BX)
			{
				if (static_cast<int32>(Row[BX]->AsNumber()) != 0)
				{
					continue;
				}
				const double CX = -Half + (BX + 0.5) * BlockSize;
				const double CZ = -Half + (BZ + 0.5) * BlockSize;
				WaterISM->AddInstance(FTransform(
					FRotator::ZeroRotator, GameToUE(CX, 0.1, CZ), FVector(BlockSize, BlockSize, 0.05)));
			}
		}
	}

	UE_LOG(LogTemp, Display, TEXT("[GTA] City built: %d buildings, %d road runs."), BuildingCount, RoadCount);
}
