       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOCKDEMO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-CUSTOMER-ID          PIC 9(6) VALUE 1.
       01  WS-TEMP-FLAG            PIC X VALUE 'N'.
       01  WS-SECRET-GATE          PIC 9 VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM HAPPY-PATH
           IF WS-CUSTOMER-ID = ZERO
               GO TO ERROR-PARA
           END-IF
           IF WS-TEMP-FLAG = 'Y'
               PERFORM RARE-PATH
           END-IF
           STOP RUN.
       HAPPY-PATH.
           DISPLAY 'OK'.
       RARE-PATH.
           IF WS-SECRET-GATE = 9
               PERFORM LOCKED-VAULT
           END-IF.
       ERROR-PARA.
           DISPLAY 'ERR'.
       LOCKED-VAULT.
           DISPLAY 'ONLY VIA MUTATION OR SECRET GATE'.
           GOBACK.
