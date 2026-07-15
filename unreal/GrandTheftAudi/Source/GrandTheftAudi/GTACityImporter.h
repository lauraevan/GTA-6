#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GTACityImporter.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMesh;
class UMaterialInterface;

/**
 * Imports the procedurally generated Neustadt Bay layout
 * (server/worldgen/citygen.py → city.json) and instances the whole city:
 * buildings (with setback tiers), roads, water cells.
 *
 * Usage: drop into a level, set CityJsonFilename (copy city.json into
 * <Project>/Content/City/), assign a cube StaticMesh (engine BasicCube works),
 * then press the "Build City" button in the Details panel.
 *
 * Coordinates: game data is metres, X-east / Z-south / Y-up (three.js).
 * UE is centimetres, X / Y ground plane, Z-up: we map (x, z, y) -> (X, Y, Z) * 100.
 */
UCLASS()
class GRANDTHEFTAUDI_API AGTACityImporter : public AActor
{
	GENERATED_BODY()

public:
	AGTACityImporter();

	/** File under Content/City/, e.g. "city.json" */
	UPROPERTY(EditAnywhere, Category = "City")
	FString CityJsonFilename = TEXT("city.json");

	/** Unit cube (100 uu) used for buildings/roads/water instances. */
	UPROPERTY(EditAnywhere, Category = "City")
	TObjectPtr<UStaticMesh> BoxMesh;

	/** Optional materials; element index = building style archetype (0..21). */
	UPROPERTY(EditAnywhere, Category = "City")
	TArray<TObjectPtr<UMaterialInterface>> StyleMaterials;

	UPROPERTY(EditAnywhere, Category = "City")
	TObjectPtr<UMaterialInterface> RoadMaterial;

	UPROPERTY(EditAnywhere, Category = "City")
	TObjectPtr<UMaterialInterface> WaterMaterial;

	UFUNCTION(CallInEditor, Category = "City")
	void BuildCity();

	UFUNCTION(CallInEditor, Category = "City")
	void ClearCity();

private:
	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> SpawnedComponents;

	UInstancedStaticMeshComponent* MakeISM(const FString& Name, UMaterialInterface* Material);
	static FVector GameToUE(double X, double Y, double Z) { return FVector(X * 100.0, Z * 100.0, Y * 100.0); }
};
