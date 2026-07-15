#include "GTAGameMode.h"
#include "GTAVehiclePawn.h"

AGTAGameMode::AGTAGameMode()
{
	DefaultPawnClass = AGTAVehiclePawn::StaticClass();
}
