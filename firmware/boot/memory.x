/*
 * The 2 MB flash map for The Frame. Offsets are 4 KB aligned because that is the RP2040's
 * erase sector, and DFU is one sector larger than ACTIVE because embassy-boot's swap needs
 * somewhere to stage a page while it exchanges the two.
 *
 * 0x000000  256 B    BOOT2, loaded by the boot ROM
 * 0x000100  23.75 K  this bootloader
 * 0x006000  4 K      bootloader state: which slot is live and whether it is confirmed
 * 0x007000  768 K    ACTIVE, the running firmware
 * 0x0C7000  772 K    DFU, where an upload lands before the swap
 * 0x188000  464 K    free
 * 0x1FC000  16 K     settings, addressed absolutely by node/src/persist.rs and never swapped
 */
MEMORY
{
    BOOT2            : ORIGIN = 0x10000000, LENGTH = 0x100
    FLASH            : ORIGIN = 0x10000100, LENGTH = 24K - 0x100
    BOOTLOADER_STATE : ORIGIN = 0x10006000, LENGTH = 4K
    ACTIVE           : ORIGIN = 0x10007000, LENGTH = 768K
    DFU              : ORIGIN = 0x100C7000, LENGTH = 772K
    RAM              : ORIGIN = 0x20000000, LENGTH = 264K
}

/* embassy-boot addresses flash by offset, not by memory-mapped address. */
__bootloader_state_start = ORIGIN(BOOTLOADER_STATE) - ORIGIN(BOOT2);
__bootloader_state_end = ORIGIN(BOOTLOADER_STATE) + LENGTH(BOOTLOADER_STATE) - ORIGIN(BOOT2);

__bootloader_active_start = ORIGIN(ACTIVE) - ORIGIN(BOOT2);
__bootloader_active_end = ORIGIN(ACTIVE) + LENGTH(ACTIVE) - ORIGIN(BOOT2);

__bootloader_dfu_start = ORIGIN(DFU) - ORIGIN(BOOT2);
__bootloader_dfu_end = ORIGIN(DFU) + LENGTH(DFU) - ORIGIN(BOOT2);

/* Carries the state sector in the bootloader image, so flashing it leaves the sector erased
   rather than holding whatever the previous firmware had at this address. */
SECTIONS
{
    .bootloader_state ORIGIN(BOOTLOADER_STATE) :
    {
        KEEP(*(.bootloader_state));
    } > BOOTLOADER_STATE
} INSERT AFTER .text;
