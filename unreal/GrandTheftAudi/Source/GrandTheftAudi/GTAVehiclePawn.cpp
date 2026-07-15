#include "GTAVehiclePawn.h"

#include "Camera/CameraComponent.h"
#include "ChaosWheeledVehicleMovementComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/SpringArmComponent.h"

AGTAVehiclePawn::AGTAVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(RootComponent);
	SpringArm->TargetArmLength = 650.f;
	SpringArm->SocketOffset = FVector(0.f, 0.f, 180.f);
	SpringArm->bEnableCameraLag = true;
	SpringArm->CameraLagSpeed = 8.f;
	SpringArm->bEnableCameraRotationLag = true;
	SpringArm->CameraRotationLagSpeed = 6.f;

	ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(SpringArm);
	ChaseCamera->SetRelativeRotation(FRotator(-6.f, 0.f, 0.f));
}

void AGTAVehiclePawn::BeginPlay()
{
	Super::BeginPlay();
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultMappingContext)
			{
				Subsystem->AddMappingContext(DefaultMappingContext, 0);
			}
		}
	}
}

void AGTAVehiclePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		if (ThrottleAction) Input->BindAction(ThrottleAction, ETriggerEvent::Triggered, this, &AGTAVehiclePawn::OnThrottle);
		if (ThrottleAction) Input->BindAction(ThrottleAction, ETriggerEvent::Completed, this, &AGTAVehiclePawn::OnThrottle);
		if (BrakeAction) Input->BindAction(BrakeAction, ETriggerEvent::Triggered, this, &AGTAVehiclePawn::OnBrake);
		if (BrakeAction) Input->BindAction(BrakeAction, ETriggerEvent::Completed, this, &AGTAVehiclePawn::OnBrake);
		if (SteerAction) Input->BindAction(SteerAction, ETriggerEvent::Triggered, this, &AGTAVehiclePawn::OnSteer);
		if (SteerAction) Input->BindAction(SteerAction, ETriggerEvent::Completed, this, &AGTAVehiclePawn::OnSteer);
		if (HandbrakeAction)
		{
			Input->BindAction(HandbrakeAction, ETriggerEvent::Started, this, &AGTAVehiclePawn::OnHandbrakePressed);
			Input->BindAction(HandbrakeAction, ETriggerEvent::Completed, this, &AGTAVehiclePawn::OnHandbrakeReleased);
		}
	}
}

void AGTAVehiclePawn::OnThrottle(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetThrottleInput(Value.Get<float>());
}

void AGTAVehiclePawn::OnBrake(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetBrakeInput(Value.Get<float>());
}

void AGTAVehiclePawn::OnSteer(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetSteeringInput(Value.Get<float>());
}

void AGTAVehiclePawn::OnHandbrakePressed()
{
	GetVehicleMovementComponent()->SetHandbrakeInput(true);
}

void AGTAVehiclePawn::OnHandbrakeReleased()
{
	GetVehicleMovementComponent()->SetHandbrakeInput(false);
}

void AGTAVehiclePawn::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	// speed-reactive FOV, same feel as the web build's chase cam
	const float SpeedKmh = FMath::Abs(GetVehicleMovementComponent()->GetForwardSpeed()) * 0.036f;
	const float TargetFov = 70.f + FMath::Min(SpeedKmh * 0.12f, 16.f);
	ChaseCamera->SetFieldOfView(FMath::FInterpTo(ChaseCamera->FieldOfView, TargetFov, DeltaTime, 4.f));
}
