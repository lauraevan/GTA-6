#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "GTAVehiclePawn.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UInputAction;
class UInputMappingContext;

/**
 * Chaos-vehicle player pawn: chase camera with speed FOV, Enhanced Input
 * throttle/brake/steer/handbrake. Assign a skeletal vehicle mesh + wheel
 * setup in a Blueprint subclass (see unreal/README.md), and import the
 * Higgsfield GLBs via Interchange for the bodywork.
 */
UCLASS()
class GRANDTHEFTAUDI_API AGTAVehiclePawn : public AWheeledVehiclePawn
{
	GENERATED_BODY()

public:
	AGTAVehiclePawn();

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> ThrottleAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> BrakeAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> SteerAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> HandbrakeAction;

protected:
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void Tick(float DeltaTime) override;

	UPROPERTY(VisibleAnywhere, Category = "Camera")
	TObjectPtr<USpringArmComponent> SpringArm;

	UPROPERTY(VisibleAnywhere, Category = "Camera")
	TObjectPtr<UCameraComponent> ChaseCamera;

private:
	void OnThrottle(const struct FInputActionValue& Value);
	void OnBrake(const struct FInputActionValue& Value);
	void OnSteer(const struct FInputActionValue& Value);
	void OnHandbrakePressed();
	void OnHandbrakeReleased();
};
