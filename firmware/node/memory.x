/*
 * The ACTIVE slot of firmware/boot/memory.x; the two must agree. The bootloader hands control to
 * the first word of FLASH, and there is no BOOT2 region because room-boot carries that stage.
 *
 * The settings store is not a region here: nothing links into it, and persist.rs addresses it at
 * 0x1FC000, past DFU.
 */
MEMORY
{
    BOOTLOADER_STATE : ORIGIN = 0x10006000, LENGTH = 4K
    FLASH            : ORIGIN = 0x10007000, LENGTH = 768K
    DFU              : ORIGIN = 0x100C7000, LENGTH = 772K
    RAM              : ORIGIN = 0x20000000, LENGTH = 264K
}

/* embassy-boot addresses flash by offset from the start of the chip, not by XIP address. */
__bootloader_state_start = ORIGIN(BOOTLOADER_STATE) - 0x10000000;
__bootloader_state_end = ORIGIN(BOOTLOADER_STATE) + LENGTH(BOOTLOADER_STATE) - 0x10000000;

__bootloader_dfu_start = ORIGIN(DFU) - 0x10000000;
__bootloader_dfu_end = ORIGIN(DFU) + LENGTH(DFU) - 0x10000000;
