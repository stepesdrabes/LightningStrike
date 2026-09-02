MEMORY {
    BOOT2 : ORIGIN = 0x10000000, LENGTH = 0x100
    /* The last 16K belong to the settings store; persist.rs addresses them by offset. */
    FLASH : ORIGIN = 0x10000100, LENGTH = 2048K - 0x100 - 16K
    RAM   : ORIGIN = 0x20000000, LENGTH = 264K
}
